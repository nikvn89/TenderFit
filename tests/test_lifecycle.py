"""
Procurement lifecycle: creation rules, bidding rules, award selection.

Award selection is the part worth pinning hardest. It runs *after* consensus
and contains no model call at all: lowest qualified price wins, ties break to
the lower bid id. That is pure arithmetic over stored state, so it can be
tested exhaustively.
"""

import json

import pytest

from conftest import QUALIFIED, NOT_QUALIFIED, ANY_PROMPT, FAR_FUTURE, hex_of

BRIEF = "Supplier must migrate 40 services and name a delivery lead."
GOOD = "We will migrate all 40 services and name a delivery lead."

NOW = 1_700_000_000
DEADLINE = NOW + 3600


@pytest.fixture
def procurement(direct_vm, contract, buyer, chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    contract.create_procurement(
        "Cloud migration", BRIEF, 100_000, DEADLINE, "[]",
    )
    return 1


class Creation:
    pass


def test_a_blank_title_is_refused(direct_vm, contract, buyer, chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="Title is required"):
        contract.create_procurement("  ", BRIEF, 100_000, DEADLINE, "[]")


def test_a_blank_brief_is_refused(direct_vm, contract, buyer, chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="Brief is required"):
        contract.create_procurement("Title", "   ", 100_000, DEADLINE, "[]")


def test_a_non_positive_budget_is_refused(direct_vm, contract, buyer,
                                          chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="max_budget must be positive"):
        contract.create_procurement("Title", BRIEF, 0, DEADLINE, "[]")


def test_a_deadline_in_the_past_is_refused(direct_vm, contract, buyer,
                                           chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="must be in the future"):
        contract.create_procurement("Title", BRIEF, 100_000, NOW - 1, "[]")


def test_malformed_requirement_json_is_refused(direct_vm, contract, buyer,
                                               chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="must be valid JSON"):
        contract.create_procurement("Title", BRIEF, 100_000, DEADLINE, "{oops")


def test_requirement_json_must_be_a_list(direct_vm, contract, buyer,
                                         chain_clock):
    chain_clock(NOW)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="must be a list"):
        contract.create_procurement(
            "Title", BRIEF, 100_000, DEADLINE, json.dumps({"a": 1}),
        )


class Bidding:
    pass


def test_the_buyer_cannot_bid_on_its_own_procurement(
    direct_vm, contract, buyer, procurement
):
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="Buyer cannot bid"):
        contract.submit_bid(1, 90_000, GOOD)


def test_a_bid_over_budget_is_refused_before_any_model_runs(
    direct_vm, contract, supplier, procurement
):
    # No mock registered: if the model were reached, this would fail loudly.
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="exceeds max_budget"):
        contract.submit_bid(1, 100_001, GOOD)


def test_a_non_positive_price_is_refused(direct_vm, contract, supplier,
                                         procurement):
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="must be positive"):
        contract.submit_bid(1, 0, GOOD)


def test_an_empty_proposal_is_refused(direct_vm, contract, supplier,
                                      procurement):
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="proposal_text is required"):
        contract.submit_bid(1, 90_000, "   ")


def test_one_bid_per_supplier_per_procurement(
    direct_vm, contract, supplier, procurement
):
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 90_000, GOOD)
    with pytest.raises(Exception, match="already submitted"):
        contract.submit_bid(1, 80_000, GOOD)


def test_bidding_closes_at_the_deadline(
    direct_vm, contract, supplier, procurement, chain_clock
):
    chain_clock(DEADLINE)
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="deadline has passed"):
        contract.submit_bid(1, 90_000, GOOD)


def test_an_unknown_procurement_id_is_refused(direct_vm, contract, supplier):
    direct_vm.sender = supplier
    with pytest.raises(Exception, match="Invalid procurement_id"):
        contract.submit_bid(99, 90_000, GOOD)


class Award:
    pass


def test_finalizing_before_the_deadline_is_refused(
    direct_vm, contract, buyer, procurement
):
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="deadline has not passed"):
        contract.finalize_procurement(1)


def test_a_procurement_with_no_bids_ends_in_no_award(
    direct_vm, contract, buyer, procurement, chain_clock
):
    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)
    assert json.loads(contract.get_procurement(1))["status"] == "NO_AWARD"


def test_a_procurement_with_only_unqualified_bids_ends_in_no_award(
    direct_vm, contract, supplier, buyer, procurement, chain_clock
):
    direct_vm.mock_llm(ANY_PROMPT, NOT_QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 50_000, "We will try.")

    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)

    data = json.loads(contract.get_procurement(1))
    assert data["status"] == "NO_AWARD"
    assert data["winner_bid_id"] == 0


def test_the_lowest_qualified_price_wins(
    direct_vm, contract, buyer, supplier, attester, outsider, procurement,
    chain_clock
):
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    for bidder, price in ((supplier, 90_000), (attester, 70_000),
                          (outsider, 80_000)):
        direct_vm.sender = bidder
        contract.submit_bid(1, price, GOOD)

    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)

    data = json.loads(contract.get_procurement(1))
    assert data["status"] == "RESOLVED"
    assert data["winning_price"] == 70_000
    assert data["winner_address"].lower() == hex_of(attester).lower()


def test_a_cheaper_unqualified_bid_does_not_win(
    direct_vm, contract, buyer, supplier, attester, procurement, chain_clock
):
    """Price alone never wins — the semantic verdict gates eligibility."""
    direct_vm.mock_llm(ANY_PROMPT, NOT_QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 10_000, "We will try our best.")

    direct_vm.clear_mocks()
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = attester
    contract.submit_bid(1, 95_000, GOOD)

    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)

    data = json.loads(contract.get_procurement(1))
    assert data["winning_price"] == 95_000
    assert data["winner_address"].lower() == hex_of(attester).lower()


def test_a_tie_breaks_to_the_earlier_bid(
    direct_vm, contract, buyer, supplier, attester, procurement, chain_clock
):
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 60_000, GOOD)
    direct_vm.sender = attester
    contract.submit_bid(1, 60_000, GOOD)

    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)

    data = json.loads(contract.get_procurement(1))
    assert data["winner_bid_id"] == 1
    assert data["winner_address"].lower() == hex_of(supplier).lower()


def test_a_procurement_cannot_be_finalized_twice(
    direct_vm, contract, buyer, procurement, chain_clock
):
    chain_clock(DEADLINE)
    direct_vm.sender = buyer
    contract.finalize_procurement(1)
    with pytest.raises(Exception, match="already finalized"):
        contract.finalize_procurement(1)


def test_finalizing_is_permissionless(
    direct_vm, contract, supplier, outsider, procurement, chain_clock
):
    """Anyone can close a procurement whose deadline has passed."""
    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 90_000, GOOD)

    chain_clock(DEADLINE)
    direct_vm.sender = outsider
    contract.finalize_procurement(1)
    assert json.loads(contract.get_procurement(1))["status"] == "RESOLVED"
