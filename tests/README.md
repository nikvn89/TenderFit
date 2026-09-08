# Contract tests — real GenVM, not a stub

48 tests over `contracts/TenderFit.py`, plus a mutation matrix that checks the
tests actually fail when the contract is wrong.

```bash
pip install "genlayer-test==0.29.2" "pytest>=8,<9"
python3 -m pytest tests/ -q          # the suite            (~2s)
python3 tests/mutation_check.py      # 20 mutants, 20 killed (~1 min)
```

Python 3.12+ (3.11 cannot import the SDK). The first run downloads a GenVM
build to `~/.cache/gltest-direct/`; after that everything is local — no network,
no wallet, no StudioNet, no rate limit.

## What is actually being run

`genlayer-test`'s Direct Mode executes the contract inside a real GenVM build.
This is not a Python stand-in for the runtime and no contract logic is copied
into the tests: `contracts/TenderFit.py` is loaded as-is, so the suite cannot
drift away from the file that is deployed.

Two things come from the harness rather than from GenVM, and both are stated
rather than faked:

- **`mock_llm`** supplies the qualification answer. The suite never invents a
  consensus outcome. It states one, then tests what the contract does with it —
  and separately drives the contract's own `validator_fn` through
  `run_validator`, including the case where the validator's model answers
  differently from the leader's.
- **`chain_clock`** overrides the contract's clock. That override should not be
  necessary; it exists because `_now()` reads `time.time()`, which Direct Mode
  cannot move. See **TF-1** in [`../SECURITY.md`](../SECURITY.md) — the same
  property that makes the deadlines untestable is what puts the value outside
  consensus.

## Files

| File | Covers |
|---|---|
| `conftest.py` | loads the real contract; gives a test control of the clock, the sender and the model answer |
| `test_attestation_gate.py` | the deterministic layer the steward review asked for: who may sign, for whom, and what a revocation does and does not reach |
| `test_qualification.py` | the consensus path — verdict handling, malformed answers, and the validator's own agreement logic |
| `test_lifecycle.py` | creation rules, bidding rules, and award selection including ties |
| `test_determinism.py` | CHARACTERIZATION: the host-clock limitation, TF-1 |
| `mutation_check.py` | 20 mutants; a green suite that misses one is reported as a gap |

## Mutation results

20 of 20 mutants killed. Each is a single edit that breaks a property the suite
claims to protect — self-attestation allowed, the revocation check inverted, the
budget ceiling removed, an unqualified bid made eligible to win, the highest
price winning instead of the lowest, the validator agreeing with anything.

Two survived the first run, and they are worth naming because they show what a
green suite can hide. `M03` (a revoked attestation still opens the gate) and
`M04` (a missing attestation no longer blocks the bid) both survived because the
tests guarding them expected *any* exception. With the gate removed the bid
simply carried on to the model, found no mocked answer, and raised there — so
the tests still passed, for entirely the wrong reason. They now arm a
`QUALIFIED` answer first and match the gate's own error message, which leaves
nothing but the gate to stop the bid.

## What this suite does not cover

The frontend. `src/` has no automated tests; the checks recorded in
`../TESTING.md` were run by hand against the deployed contract.
