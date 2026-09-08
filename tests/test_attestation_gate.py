"""
The attestation gate — the change the Aug 2026 steward review asked for.

The point of V2 is that material claims ("ISO 27001 certified", "has a named
delivery lead") are no longer taken from supplier-authored prose and handed to
a model as fact. They are signed on-chain by a third party the buyer accepted
in advance, and the contract checks that signature deterministically before any
model is involved.

Everything below is that gate. None of it needs a model to run.
"""

import json

import pytest

from conftest import QUALIFIED, ANY_PROMPT, FAR_FUTURE, hex_of, requirement


ISO = "iso27001"


@pytest.fixture
def procurement_with_requirement(direct_vm, contract, buyer, attester,
                                 chain_clock):
    chain_clock(1_700_000_000)
    direct_vm.sender = buyer
    contract.create_procurement(
        "Cloud migration",
        "Supplier must migrate 40 services and name a delivery lead.",
        100_000,
        FAR_FUTURE,
        json.dumps([requirement(ISO, "ISO 27001 certification", [attester])]),
    )
    return 1


def sign(vm, contract, *, by, about, statement="Audited and certified."):
    vm.sender = by
    contract.attest(hex_of(about), ISO, statement)


def bid(vm, contract, *, by, procurement=1, price=90_000,
        text="We will migrate all 40 services and name a delivery lead."):
    vm.sender = by
    contract.submit_bid(procurement, price, text)


class AttestationSigning:
    pass


def test_a_supplier_cannot_attest_for_itself(direct_vm, contract, supplier):
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="Self-attestation"):
        contract.attest(hex_of(supplier), ISO, "I certify myself.")


def test_a_buyer_cannot_list_itself_as_an_accepted_attester(
    direct_vm, contract, buyer, chain_clock
):
    chain_clock(1_700_000_000)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="Buyer cannot be an accepted attester"):
        contract.create_procurement(
            "Self-signed", "A brief.", 100_000, FAR_FUTURE,
            json.dumps([requirement(ISO, "ISO 27001", [buyer])]),
        )


def test_an_empty_statement_is_refused(direct_vm, contract, attester, supplier):
    direct_vm.sender = attester
    with pytest.raises(Exception, match="Invalid statement"):
        contract.attest(hex_of(supplier), ISO, "   ")


def test_an_attestation_is_stored_under_attester_supplier_and_key(
    direct_vm, contract, attester, supplier
):
    sign(direct_vm, contract, by=attester, about=supplier)
    record = json.loads(
        contract.get_attestation(hex_of(attester), hex_of(supplier), ISO)
    )
    assert record["revoked"] is False
    assert record["statement"] == "Audited and certified."
    assert record["req_key"] == ISO
    assert record["attester"].lower() == hex_of(attester).lower()
    assert record["supplier"].lower() == hex_of(supplier).lower()
    # The statement is also committed by hash, so a bid can cite it later.
    assert len(record["statement_hash"]) == 64


class TheGate:
    pass


def test_a_bid_without_the_required_attestation_is_refused(
    direct_vm, contract, supplier, procurement_with_requirement
):
    """A model answer is armed on purpose.

    Without the mock this test would pass even with the gate removed, because
    the bid would then reach `exec_prompt` and fail there for an unrelated
    reason. Arming a QUALIFIED answer means the only thing that can stop the
    bid is the gate itself.
    """
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    with pytest.raises(Exception, match="Missing accepted attestation"):
        bid(direct_vm, contract, by=supplier)
    direct_vm.clear_mocks()


def test_an_attestation_from_an_unaccepted_signer_does_not_open_the_gate(
    direct_vm, contract, supplier, outsider, procurement_with_requirement
):
    sign(direct_vm, contract, by=outsider, about=supplier)
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    with pytest.raises(Exception, match="Missing accepted attestation"):
        bid(direct_vm, contract, by=supplier)
    direct_vm.clear_mocks()


def test_an_accepted_signer_opens_the_gate(
    direct_vm, contract, supplier, attester, procurement_with_requirement
):
    sign(direct_vm, contract, by=attester, about=supplier)
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    bid(direct_vm, contract, by=supplier)

    stored = json.loads(contract.get_bid(1))
    assert stored["qualified"] is True
    assert stored["price"] == 90_000


def test_an_attestation_signed_for_a_different_supplier_does_not_carry_over(
    direct_vm, contract, supplier, outsider, attester,
    procurement_with_requirement
):
    sign(direct_vm, contract, by=attester, about=outsider)
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    with pytest.raises(Exception, match="Missing accepted attestation"):
        bid(direct_vm, contract, by=supplier)
    direct_vm.clear_mocks()


def test_a_revoked_attestation_no_longer_opens_the_gate(
    direct_vm, contract, supplier, attester, procurement_with_requirement
):
    sign(direct_vm, contract, by=attester, about=supplier)
    direct_vm.sender = attester
    contract.revoke_attestation(hex_of(supplier), ISO)

    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    with pytest.raises(Exception, match="Missing accepted attestation"):
        bid(direct_vm, contract, by=supplier)
    direct_vm.clear_mocks()


def test_revocation_does_not_reach_back_into_a_bid_already_submitted(
    direct_vm, contract, supplier, attester, procurement_with_requirement
):
    """The per-bid snapshot is the whole point: a bid stays auditable."""
    sign(direct_vm, contract, by=attester, about=supplier)
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    bid(direct_vm, contract, by=supplier)

    direct_vm.sender = attester
    contract.revoke_attestation(hex_of(supplier), ISO)

    # Current attestation state has changed...
    record = json.loads(
        contract.get_attestation(hex_of(attester), hex_of(supplier), ISO)
    )
    assert record["revoked"] is True

    # ...but the bid still carries the evidence it was accepted on.
    stored = json.loads(contract.get_bid(1))
    assert stored["qualified"] is True
    snapshot = stored["attestations_relied_on"]
    assert len(snapshot) == 1
    assert snapshot[0]["req_key"] == ISO
    assert snapshot[0]["attester"].lower() == hex_of(attester).lower()
    # The snapshot pins the exact statement, not a pointer to live state.
    assert snapshot[0]["statement_hash"] == record["statement_hash"]


def test_only_the_signing_attester_can_revoke(
    direct_vm, contract, supplier, attester, outsider,
    procurement_with_requirement
):
    sign(direct_vm, contract, by=attester, about=supplier)
    direct_vm.sender = outsider
    with pytest.raises(Exception, match="Attestation not found"):
        contract.revoke_attestation(hex_of(supplier), ISO)


def test_an_attestation_cannot_be_revoked_twice(
    direct_vm, contract, supplier, attester
):
    sign(direct_vm, contract, by=attester, about=supplier)
    direct_vm.sender = attester
    contract.revoke_attestation(hex_of(supplier), ISO)
    with pytest.raises(Exception, match="already revoked"):
        contract.revoke_attestation(hex_of(supplier), ISO)
