# Security model and known limitations

TenderFit awards public-procurement contracts on the strength of a verdict
produced by AI validators. This document states what the contract actually
guarantees, what it does not, and which weaknesses are known and open. It is
written for a reviewer who wants to check the claims rather than take them.

The deterministic half of every claim below is covered by
[`tests/`](tests/README.md) — 48 tests that run the deployed contract on a real
GenVM build, and a mutation matrix that confirms they fail when the property
they defend is broken.

Deployed contract:
`0xfF53f36e409FBC2d42b15e214801656006A7A226`
([explorer](https://explorer-studio.genlayer.com/address/0xfF53f36e409FBC2d42b15e214801656006A7A226))

---

## 0. What this contract is

`contracts/TenderFit.py` is the **BidMatch** Intelligent Contract, deployed
separately for this project. One source file backs two submissions: BidMatch as
the standalone primitive, TenderFit as the full procurement workflow around it.
The class is still named `BidMatch` because that is what is on chain, and the
source here is byte-identical to the deployment — see the README section
"Relationship to the BidMatch Intelligent Contract" for why it is not renamed.

Everything in this document describes that shared contract. The frontend, the
test suite and the workflow are TenderFit's alone.

---

## 1. The two-layer design

The Aug 2026 steward review made the point that shaped V2: a supplier's own
prose about its credentials is not evidence. So qualification is split.

| Layer | Decides | Trusted to |
|---|---|---|
| **Contract, before the model** | whether material requirements are covered | a third party the buyer named *before bidding opened* has signed for this exact supplier and requirement key. The supplier cannot sign for itself; the buyer cannot name itself as a signer |
| **GenLayer validators** | whether the remaining natural-language commitments in the brief are met | read the brief and the proposal as data, return one boolean, nothing else |
| **Contract, after the model** | who wins | lowest qualified price, ties to the earlier bid. No model involvement |

What that separation buys: a model can never pick the winner, never move the
price, and never decide that an unattested credential counts. It answers one
yes/no question, and the contract does everything consequential around it.

## 2. What the contract enforces

Each item is covered by a named test.

- A supplier cannot attest for itself; a buyer cannot list itself as an
  accepted attester.
- An attestation from an unaccepted signer, for a different supplier, or one
  that has been revoked, does not open the bid gate.
- The bid gate runs **before** the model, so an unattested bid never reaches —
  or pays for — consensus.
- Each bid stores an immutable snapshot of the attestations it relied on,
  including a hash of the statement. Revoking afterwards changes current state
  and leaves the bid's evidence intact.
- Bidding closes at the deadline; the buyer cannot bid on its own procurement;
  one bid per supplier; price must be positive and within budget.
- Over-budget bids are rejected deterministically, before consensus.
- A malformed or non-boolean model answer reverts. It does not quietly become
  "not qualified".
- Validators re-run the judgment independently and compare only the boolean; a
  leader that errored is rejected rather than agreed with.
- Award selection is pure arithmetic: lowest qualified price, ties to the lower
  bid id. A cheaper unqualified bid never wins.
- Finalization is permissionless once the deadline has passed, and happens once.

## 3. Known limitations — open

### TF-1 — the contract's clock is host wall-clock, not consensus time

`_now()` returns `int(time.time())`. GenLayer's own linter says so:

```text
$ python3 -m genvm_linter.cli check contracts/TenderFit.py
line 182: Non-deterministic call 'time.time()'
```

That value is produced independently by whichever machine executes the method,
and it decides three consequential things: whether a procurement may be created,
whether a bid arrives before the deadline, and whether a procurement may be
finalized. The transaction already carries a timestamp every node agrees on —
`gl.message_raw["datetime"]` — and the contract does not read it.

This has not been observed to break a transaction on StudioNet, and this
document does not claim it has. What the tests demonstrate is the precondition:
move the VM's block clock two years past a deadline and the contract accepts the
bid anyway, because it is not looking at the block clock.

*Tests:* `tests/test_determinism.py` — four cases, including
`test_the_chain_clock_does_not_reach_the_contract`.

*Fix:* read `gl.message_raw["datetime"]` and convert arithmetically. It changes
`contracts/TenderFit.py` and therefore needs a redeploy, which would move the
address the published listing points at — so it is documented and measured here
rather than silently patched.

*A note for whoever writes the fix:* `direct_vm.warp()` moves the block
timestamp the VM reports but does **not** refresh `gl.message_raw["datetime"]`
in genlayer-test 0.29.2. Tests for the fixed contract will need to set that key
directly.

## 4. Known limitations — accepted by design

- **An attestation is a signature, not a verification.** The contract proves
  that a specific accepted signer said something about a specific supplier. It
  does not check that the statement is true. The buyer chooses who it trusts,
  before bidding opens, and that choice is on the record.
- **Deterministic validator re-run is not an injection defence.** Validators
  run the same shape of prompt over the same text as the leader, so a proposal
  crafted to steer the model can steer both. The mitigations are structural:
  user text is `json.dumps`-encoded before interpolation, the prompt states that
  brief and proposal are untrusted data, and — most importantly — the model
  returns one boolean, so there is no free-text field for an injection to
  populate and nothing about price or winner selection for it to reach.
- **Semantic judgment is judgment.** A proposal that a careful human would call
  borderline may qualify or not. The design bounds the *consequence*, not the
  ambiguity: an unqualified bid is simply ineligible, and the buyer can create
  a new procurement.
- **StudioNet demo.** No funds move on-chain; awards are records, not payments.
  A Project Explorer listing for this should be read as **Preview**, not Live.

## 5. Reporting

Open an issue at <https://github.com/nikvn89/TenderFit/issues>. There is no bug
bounty and no funds at risk: this is a StudioNet deployment.
