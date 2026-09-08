"""
CHARACTERIZATION — the contract's clock is host wall-clock, not chain time.

Tracked in SECURITY.md as **TF-1**. These tests assert what the deployed
contract does today rather than what it should do, because what it does today
is a real weakness. When it is fixed they must be inverted.

`_now()` returns `int(time.time())`. GenLayer's own linter flags it:

    $ python3 -m genvm_linter.cli check contracts/TenderFit.py
    line 182: Non-deterministic call 'time.time()'

That value is produced independently by whichever machine executes the method,
and it decides three consequential things: whether a procurement may be
created, whether a bid arrives before the deadline, and whether a procurement
may be finalized. The transaction carries a committed timestamp —
`gl.message_raw["datetime"]` — and the contract does not read it.

Fixing this changes `contracts/TenderFit.py` and therefore needs a redeploy,
which would move the address the published listing points at. So it is
documented and measured here rather than silently patched.
"""

import json

import pytest

from conftest import QUALIFIED, ANY_PROMPT, FAR_FUTURE

BRIEF = "Supplier must migrate 40 services and name a delivery lead."
GOOD = "We will migrate all 40 services and name a delivery lead."


def test_the_chain_clock_does_not_reach_the_contract(
    direct_vm, contract, buyer, supplier
):
    """Move the block timestamp past the deadline. Nothing changes.

    No `chain_clock` fixture here on purpose: this is the contract running on
    its real time source. The procurement's deadline is in 2033. The VM's block
    timestamp is then warped to 2035 — comfortably past it. A contract reading
    chain time would refuse the bid. This one accepts it, because the deadline
    is being compared against the machine's own wall clock instead.
    """
    direct_vm.sender = buyer
    contract.create_procurement(
        "Cloud migration", BRIEF, 100_000, FAR_FUTURE, "[]",
    )

    direct_vm.warp("2035-01-01T00:00:00Z")

    direct_vm.mock_llm(ANY_PROMPT, QUALIFIED)
    direct_vm.sender = supplier
    contract.submit_bid(1, 90_000, GOOD)

    # Accepted well after the block clock says the deadline passed.
    assert json.loads(contract.get_procurement(1))["bid_count"] == 1


def test_identical_calls_write_different_state_on_different_hosts(
    direct_vm, contract, buyer, chain_clock
):
    """Same calldata, same chain state, different machine clock.

    `bidding_open` is derived from `_now()` at read time, so two nodes reading
    the same stored procurement at the same block can disagree about whether
    bidding is open.
    """
    chain_clock(1_700_000_000)
    direct_vm.sender = buyer
    deadline = 1_700_003_600
    contract.create_procurement("Cloud migration", BRIEF, 100_000, deadline,
                                "[]")

    chain_clock(deadline - 1)
    assert json.loads(contract.get_procurement(1))["bidding_open"] is True

    chain_clock(deadline + 1)
    assert json.loads(contract.get_procurement(1))["bidding_open"] is False


def test_creation_validity_depends_on_the_machine_that_runs_it(
    direct_vm, contract, buyer, chain_clock
):
    """The same create call is valid on one clock and reverts on another."""
    deadline = 1_700_003_600

    chain_clock(deadline + 1)
    direct_vm.sender = buyer
    with pytest.raises(Exception, match="must be in the future"):
        contract.create_procurement("Late", BRIEF, 100_000, deadline, "[]")

    chain_clock(deadline - 1)
    contract.create_procurement("Early", BRIEF, 100_000, deadline, "[]")
    assert json.loads(contract.get_procurement(1))["title"] == "Early"


def test_the_committed_transaction_timestamp_is_available_and_unused(
    direct_vm, contract, buyer
):
    """`gl.message_raw["datetime"]` exists — the contract just never reads it.

    This is the fix: a value every node agrees on, already delivered with the
    transaction. `contracts/TenderFit.py` contains no reference to it.

    A note for whoever writes the fix: `direct_vm.warp()` moves the block
    timestamp the VM reports but does **not** refresh
    `gl.message_raw["datetime"]` in genlayer-test 0.29.2. Tests for the fixed
    contract will need to set that key directly rather than relying on warp.
    """
    source = (
        __import__("pathlib").Path(__file__).resolve().parents[1]
        / "contracts" / "TenderFit.py"
    ).read_text(encoding="utf-8")

    assert "time.time()" in source
    assert 'message_raw["datetime"]' not in source

    import re
    import sys

    gl = sys.modules.get("genlayer.gl")
    assert gl is not None and gl.message_raw is not None
    committed = gl.message_raw["datetime"]

    # A single ISO-8601 instant, delivered with the transaction, identical for
    # every node that executes it. This is what `_now()` should be reading.
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z",
                        committed), committed
