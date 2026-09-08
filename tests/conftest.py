"""
Shared fixtures for the TenderFit Direct Mode suite.

Every test here runs `contracts/TenderFit.py` on a real GenVM build through
`genlayer-test`'s Direct Mode. The contract is not stubbed, re-implemented or
copied — the file under test is the file in this repository, so the suite
cannot drift away from what is deployed.

Two things are supplied by the harness rather than by GenVM:

* `mock_llm` feeds the qualification prompt a fixed answer. The suite never
  invents a validator outcome; it states one and then tests what the contract
  does with it, including through `run_validator`.
* `chain_clock` overrides the contract's clock. That override should not be
  necessary and it is documented in SECURITY.md as TF-1: `_now()` reads
  `time.time()`, the host wall clock, which Direct Mode cannot move. Every
  deadline path in the contract is therefore untestable without reaching into
  the module — which is the same property that puts the value outside
  consensus.
"""

import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Overridable so the mutation harness can point this same suite at a mutant.
CONTRACT = pathlib.Path(
    __import__("os").environ.get("TENDERFIT_CONTRACT")
    or ROOT / "contracts" / "TenderFit.py"
)

QUALIFIED = json.dumps({"qualified": True})
NOT_QUALIFIED = json.dumps({"qualified": False})

# Any prompt. The contract issues exactly one kind.
ANY_PROMPT = r"."

FAR_FUTURE = 2_000_000_000


def hex_of(address) -> str:
    """Normalise whatever gltest hands back into the 0x-hex the contract wants.

    The pytest fixtures return SDK `Address` objects while
    `create_test_addresses` returns raw bytes, so accept both.
    """
    if isinstance(address, (bytes, bytearray)):
        return "0x" + bytes(address).hex()

    for attribute in ("as_hex", "hex"):
        value = getattr(address, attribute, None)
        if value is not None:
            return value() if callable(value) else value

    return str(address)


class _FrozenTime:
    """Stands in for the `time` module inside the contract."""

    current = 1_700_000_000

    @classmethod
    def time(cls):
        return cls.current


@pytest.fixture
def contract(direct_vm, direct_deploy):
    return direct_deploy(CONTRACT)


@pytest.fixture
def chain_clock(contract):
    """Steer the contract's clock, and hand back a setter."""
    module = sys.modules[type(contract).__module__]
    original = module.time
    module.time = _FrozenTime
    _FrozenTime.current = 1_700_000_000

    def set_to(timestamp: int) -> int:
        _FrozenTime.current = int(timestamp)
        return int(timestamp)

    yield set_to
    module.time = original


@pytest.fixture
def buyer(direct_owner):
    return direct_owner


@pytest.fixture
def supplier(direct_alice):
    return direct_alice


@pytest.fixture
def attester(direct_bob):
    return direct_bob


@pytest.fixture
def outsider(direct_charlie):
    return direct_charlie


def requirement(req_key: str, label: str, attesters) -> dict:
    return {
        "req_key": req_key,
        "label": label,
        "accepted_attesters": [hex_of(a) for a in attesters],
    }


def open_procurement(vm, contract, buyer, *, requirements=None, budget=100_000,
                     deadline=FAR_FUTURE, title="Cloud migration",
                     brief="Supplier must migrate 40 services and commit to a "
                           "six week cutover with a named delivery lead."):
    vm.sender = buyer
    contract.create_procurement(
        title, brief, budget, deadline,
        json.dumps(requirements or []),
    )
    return len(json.loads(contract.get_procurement(1))["title"]) and 1
