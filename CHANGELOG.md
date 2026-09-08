# Changelog

All notable changes to TenderFit. Format follows
[Keep a Changelog](https://keepachangelog.com/).

---

## [0.2.0] — 2026-09-07 — Contract Test Suite on Real GenVM, and Three Frontend Fixes

**No contract change and no redeploy.** `contracts/TenderFit.py` is
byte-identical to the deployed version at
`0xfF53f36e409FBC2d42b15e214801656006A7A226` (sha256
`ad71a64f…7af3c28`). One contract weakness was found and is documented rather
than patched, because patching it means redeploying and moving the address the
published listing points at.

### Added

- **48 tests that run the deployed contract on a real GenVM build**, via
  `genlayer-test` Direct Mode. Not a Python stand-in for the runtime, and no
  contract logic copied into the tests — `contracts/TenderFit.py` is loaded
  as-is, so the suite cannot drift from what is deployed.

  The repository previously had no automated tests at all. `TESTING.md` and
  `STATIC_CHECK.txt` recorded roughly thirty PASS lines, all of them run by hand
  and none of them re-runnable by a reviewer.

  Coverage: the attestation gate (who may sign, for whom, what a revocation
  reaches and what it does not), the consensus path (verdict handling,
  malformed answers, and the contract's own `validator_fn` driven through
  `run_validator` — including the case where the validator's model disagrees
  with the leader's), creation and bidding rules, and award selection including
  the tie-break.

- **A mutation matrix, `tests/mutation_check.py` — 20 of 20 mutants killed.**
  A green suite proves nothing until it is shown to go red. Two survived the
  first run and are named in `tests/README.md`: both attestation-gate negative
  tests were passing for the wrong reason, because with the gate removed the bid
  reached the model, found no mocked answer, and raised there instead.

- **`SECURITY.md`** — the two-layer trust boundary, what the contract enforces,
  and one open weakness:

  - **TF-1.** `_now()` returns `int(time.time())`. GenLayer's own linter flags
    it (`line 182: Non-deterministic call 'time.time()'`). That value decides
    whether a procurement may be created, whether a bid beats the deadline and
    whether a procurement may be finalized — and it is produced independently by
    whichever machine executes the call. The transaction already carries
    `gl.message_raw["datetime"]`, which every node agrees on; the contract does
    not read it. `tests/test_determinism.py` demonstrates the precondition:
    move the VM's block clock two years past a deadline and the contract accepts
    the bid anyway.

- **A stated relationship to the BidMatch Intelligent Contract.**
  `contracts/TenderFit.py` *is* the BidMatch contract — one source file backing
  two submissions, deployed separately — and the class is still named
  `BidMatch`. Nothing in the repository said so, which left a reviewer to
  notice the mismatch and draw their own conclusion. README and `SECURITY.md`
  now state it, along with why the class is deliberately not renamed: the source
  here is byte-identical to the deployment, and renaming would change the
  published sha256 and break that parity for a cosmetic gain. A rename belongs
  in the same release as a redeploy.

- **`.github/workflows/ci.yml`** — the repository had no CI. `npm ci`,
  `npm run build`, the suite and the mutation matrix now run on every push.

- **`tests/README.md`**, **`gltest.config.yaml`**, and a `.gitignore` that
  covers Python and test-run artefacts.

### Fixed

- **Every write was gated behind a MetaMask Snap that none of them need.**
  `getWriteClient` called `client.connect('studionet')` before signing, and
  every write went through it. Reading the SDK (genlayer-js 1.1.8,
  `dist/index.js`) makes the cost explicit: `connect()` calls
  `wallet_getSnaps`, then `wallet_requestSnaps` when the GenLayer Snap is
  absent. Signing needs none of that — writes go out through
  `eth_sendTransaction` on the injected provider. A reviewer without the Snap,
  or one who declined the prompt, was blocked from creating a procurement,
  bidding, attesting, revoking and finalizing.

  Replaced with `ensureStudioNet()` in the new `src/chain.ts`:
  `wallet_switchEthereumChain`, falling back to `wallet_addEthereumChain` on
  4902. Same network onboarding, no Snap.

  This also has to happen in the app rather than being left to the SDK.
  `assertChainMatch` in that same file opens with
  `if (chainConfig.isStudio) return;`, and `studionet.isStudio` is `true` — so
  the SDK deliberately does **not** check the wallet's network before
  `eth_sendTransaction` on StudioNet. A wallet left on mainnet would have been
  asked to sign against the wrong chain.

- **The app reported success for transactions that had not succeeded.** Each
  handler took the hash `writeContract` returns and immediately displayed
  "Procurement created", "Attestation signed", "Attestation revoked". On
  GenLayer a transaction that reverts at consensus still returns a hash, so a
  hash means "submitted" and nothing more. The worst case was
  `finalize_procurement` — the step that runs the award — reported as done
  without anyone having confirmed it landed.

  Writes now wait for `ACCEPTED` and throw if the receipt shows a rollback. The
  hash still appears immediately, labelled as pending, and only turns into a
  success message once the chain has accepted it.

  On StudioNet the receipt does not carry `txExecutionResultName`:
  `waitForTransactionReceipt` routes `isStudio` chains through
  `decodeLocalnetTransaction`, and only `decodeTransaction` sets that field. So
  the check reads the enum when present, the leader receipt's execution result
  when it is not, and treats neither as failure when both are absent.

- **All RPC traffic went cross-origin to Studio.** Neither `vite.config.ts` nor
  `vercel.json` proxied it. Studio answers a rate-limited request without CORS
  headers, so throttling reaches the browser as an opaque
  `Failed to fetch … viem@…` rather than the 429 it is. Both now proxy
  `/api/rpc` same-origin, and `config.ts` points the client at that path.
  MetaMask still registers the network by its absolute URL, which is what
  `VITE_STUDIO_WALLET_RPC` is for.

- **`STATIC_CHECK.txt` advertised a preview deployment URL** that will not
  outlive the deployment. The canonical URL is the one in the README.

### Not changed

- `contracts/TenderFit.py` — untouched. The deployed contract at
  `0xfF53f36e409FBC2d42b15e214801656006A7A226` is unaffected and **no redeploy
  is required** for this release.
- The qualification prompt. It is the strongest part of the contract and was
  left alone: user text is `json.dumps`-encoded before interpolation, the
  security boundary is stated explicitly, exactly one boolean leaves the nondet
  block, and validators re-run the judgment and compare only that boolean.

### Verified

```text
npm ci                                 rc 0
npm run build                          rc 0
python3 -m pytest tests/ -q            rc 0   48 tests
python3 tests/mutation_check.py        rc 0   20/20 killed
genvm_linter check contracts/          lint passed (1 warning: TF-1)
```

---

## [0.1.0] — Published release

Procurement qualification with deterministic material-attestation gates plus
GenLayer semantic consensus. Responds to the Aug 25, 2026 steward review by
separating supplier qualification into two layers: contract-side signed
attestations for material credentials, and validator consensus for the
remaining natural-language commitments.
