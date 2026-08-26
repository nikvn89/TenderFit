# TenderFit V2 — Steward-Fixed Runtime-Passed Build

**Procurement qualification with deterministic material-attestation gates plus GenLayer semantic consensus.**

TenderFit V2 responds to the Aug 25, 2026 steward feedback by separating supplier qualification into two layers: contract-side signed attestations for material credentials/capability, and GenLayer validator consensus for the remaining natural-language commitments.

## Canonical deployment

```text
Contract: 0xfF53f36e409FBC2d42b15e214801656006A7A226
Network: GenLayer StudioNet
Contract source SHA-256: ad71a64f34d864381244d531967c13d15d4fd268824c30931249f32417af3c28
```

Explorer:  
https://explorer-studio.genlayer.com/address/0xfF53f36e409FBC2d42b15e214801656006A7A226

GitHub:  
https://github.com/nikvn89/TenderFit

Vercel:  
https://tender-fit.vercel.app/

The frontend has been locally built and smoke-tested live on Vercel against the canonical steward-fixed contract.

## Steward feedback addressed

The previous version could qualify a supplier based on supplier-authored text about credentials or capability. V2 no longer asks GenLayer validators to treat those material claims as verified facts.

### 1. Material requirements — deterministic signed attestations

At procurement creation, the Buyer may configure up to four material requirements. Each requirement contains:

```text
req_key
human-readable label
1–3 accepted attester wallets
```

Examples include certification, eligibility, or material capability requirements.

The Buyer fixes the accepted attesters before bidding. A supplier cannot choose its own trusted attester.

An attester signs on-chain through:

```text
attest(supplier, req_key, statement)
```

The contract deterministically rejects:

```text
supplier self-attestation
buyer-as-attester configuration
missing accepted attestation at bid submission
revoked attestations for new bids
```

The material gate executes **before the semantic consensus call**.

### 2. Semantic requirements — GenLayer consensus

GenLayer still evaluates natural-language commitments such as:

```text
scope
methodology
delivery commitments
commercial commitments
```

The semantic result is intentionally narrow:

```text
qualified = true
qualified = false
```

The consensus prompt receives the procurement brief, proposal, and human-readable material labels already checked by the contract. It does not use attester wallet addresses, storage keys, bid ids, price ranking, or winner state as semantic evidence.

AI never ranks suppliers and never selects the winner.

## Immutable per-bid attestation snapshot

A bid records the material attestations relied on at submission time:

```text
attester
supplier
req_key
statement_hash
```

A later revocation changes the current attestation state for future bids only. It does not retroactively alter a previously stored bid or its qualification result.

## Deterministic procurement rules

The contract continues to enforce:

```text
budget limit
bidding deadline
buyer cannot bid on own procurement
one bid per wallet per procurement
maximum bid count
lowest qualified price wins
lower bid id wins a price tie
finalization without an AI call
```

## Runtime evidence — StudioNet

Wallet shorthand used during testing:

```text
7F4 = Buyer
A61 = Supplier
701 = Buyer-accepted attester
```

### Procurement #1 — material attestation path

Material requirement:

```text
req_key: iso9001
label: Valid ISO 9001 certification
accepted attester: 701
```

Observed results:

- T1 — procurement stored the exact material requirement and accepted attester: **PASS**.
- T2 — A61 submitted a bid before an accepted attestation existed: reverted with `Missing accepted attestation for requirement 'iso9001'`: **PASS**.
- T3 — A61 tried to attest for itself: reverted with `Self-attestation is not accepted`: **PASS**.
- T4 — 7F4 created an attestation for A61, but 7F4 was not an accepted attester; A61's bid still reverted with the same missing-accepted-attestation error: **PASS**.
- T5 — 701 attested for A61. A61's bid #1 then succeeded and stored `qualified=true` plus the attestation snapshot: **PASS**.
- T6 — 701 revoked the current attestation. `get_attestation` changed to `revoked=true`, while bid #1 remained `qualified=true` with the original immutable snapshot: **PASS**.

Attestation statement hash used by bid #1:

```text
412ee46b0f8ee92d7ec71d0559735292a966232ed3179e67171525e369ae66ef
```

### Procurement #2 — semantic-only compatibility

Created with:

```text
attested_requirements_json = []
```

Observed:

- bid #2, incomplete semantic proposal -> `qualified=false`, `attestations_relied_on=[]`;
- bid #3, complete semantic proposal -> `qualified=true`, `attestations_relied_on=[]`.

This confirms the steward fix does not force attestations on procurements that intentionally use the semantic-only path.

### Procurement #3 — deterministic finalization regression

A short-deadline semantic-only procurement was used to verify the final winner logic after the V2 changes.

Observed final result:

```json
{
  "procurement_id": 3,
  "status": "RESOLVED",
  "winner_address": "0x43F4f5c0946108Dc41542c8aF51E0aA0C253E701",
  "winner_bid_id": 5,
  "winning_price": 70000
}
```

Finalization completed successfully and selected the qualified lowest-price bid deterministically.

## Honest limitation

TenderFit does **not** independently prove that a certification or capability exists in the real world. It proves that a Buyer-approved third-party attester — never the Supplier and never the Buyer — signed for the configured material requirement on-chain before the bid was submitted. The trustworthiness and real-world basis of an attester's statement remain outside the contract.

## Frontend V2 — final steward UI

The frontend exposes:

- material requirement editor at procurement creation;
- accepted-attester addresses on procurement views;
- attestation desk for signing and revoking;
- per-bid attestation proof chips;
- explicit separation between contract-side material verification and GenLayer semantic review;
- honest limitation wording.

The default frontend contract address is already set to the canonical deployment above. The marketplace hero and decision route now mirror the V2 execution order: verify material attestations → qualify semantic fit → award deterministically by price.

## Run locally

```bash
npm install
npm run build
npm run dev
```

Then verify the dashboard reads contract:

```text
0xfF53f36e409FBC2d42b15e214801656006A7A226
```

## Final verification status

The steward-fixed contract and frontend are ready for resubmission.

Verified evidence:

- StudioNet runtime suite T1–T8: **PASS**;
- deterministic finalization regression: **PASS**;
- local production build and local UI read flow: **PASS**;
- Vercel live render: **PASS**;
- Vercel live procurement #1 read: material requirement, accepted attester, qualified bid, attestation proof chip, and Attestation Desk all rendered correctly;
- canonical contract displayed by the frontend: `0xfF53f36e409FBC2d42b15e214801656006A7A226`.

Live dApp:  
https://tender-fit.vercel.app/

For portal resubmission, use the canonical Explorer address above and this final repository build.
