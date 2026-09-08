# TenderFit V2 — Runtime Evidence

Canonical StudioNet contract:

```text
0xfF53f36e409FBC2d42b15e214801656006A7A226
```

Explorer:  
https://explorer-studio.genlayer.com/address/0xfF53f36e409FBC2d42b15e214801656006A7A226

## Wallets

```text
7F4 = 0x6276095FAEA15108740445ff277fdA8c304657F4  (Buyer)
A61 = 0xE7241B8b44e3f8a0FcCdfF6f4b76380d152F2A61  (Supplier)
701 = 0x43F4f5c0946108Dc41542c8aF51E0aA0C253E701  (accepted attester / later bidder)
```

## T1 — Material requirement stored — PASS

Procurement #1 was created with:

```json
[
  {
    "req_key": "iso9001",
    "label": "Valid ISO 9001 certification",
    "accepted_attesters": ["0x43F4f5c0946108Dc41542c8aF51E0aA0C253E701"]
  }
]
```

`get_procurement(1)` returned the exact material requirement and accepted attester, `status=OPEN`, `bid_count=0`.

## T2 — Missing accepted attestation blocks bid — PASS

Caller: A61.

Observed rollback:

```text
Missing accepted attestation for requirement 'iso9001'
```

This is the key steward test: the material gate prevents the supplier's proposal from reaching semantic qualification without an accepted third-party attestation.

## T3 — Supplier self-attestation rejected — PASS

A61 called `attest` for A61.

Observed rollback:

```text
Self-attestation is not accepted
```

## T4 — Unaccepted attester does not satisfy gate — PASS

7F4 signed an attestation for A61. Because procurement #1 only accepts 701 for `iso9001`, A61's next bid still reverted:

```text
Missing accepted attestation for requirement 'iso9001'
```

## T5 — Accepted attester unlocks gate — PASS

701 attested for A61 / `iso9001`.

`get_attestation` observed:

```text
attester: 701
supplier: A61
req_key: iso9001
revoked: false
statement_hash: 412ee46b0f8ee92d7ec71d0559735292a966232ed3179e67171525e369ae66ef
```

A61 then submitted bid #1 at price 90000. `get_bid(1)` observed:

```text
qualified: true
attestations_relied_on: [701 / A61 / iso9001 / same statement_hash]
```

## T6 — Revocation is non-retroactive — PASS

701 revoked the current A61 / `iso9001` attestation.

Current attestation:

```text
revoked: true
```

Bid #1 remained:

```text
qualified: true
statement_hash: 412ee46b0f8ee92d7ec71d0559735292a966232ed3179e67171525e369ae66ef
```

The bid's stored attestation snapshot was unchanged.

## T7 — Semantic-only [] compatibility — PASS

Procurement #2 was created with:

```text
attested_requirements_json = []
```

Observed:

```text
bid #2 / A61 / 75000
proposal incomplete
qualified: false
attestations_relied_on: []

bid #3 / 701 / 70000
proposal complete
qualified: true
attestations_relied_on: []
```

This proves the V2 attestation feature is opt-in per procurement and does not break the prior semantic-only behavior.

## T8 — Deterministic finalization regression — PASS

Procurement #3 used a short deadline and semantic-only configuration. After bidding closed, `finalize_procurement(3)` finalized successfully.

`get_result(3)` observed:

```json
{
  "procurement_id": 3,
  "status": "RESOLVED",
  "winner_address": "0x43F4f5c0946108Dc41542c8aF51E0aA0C253E701",
  "winner_bid_id": 5,
  "winning_price": 70000
}
```

Winner selection remained deterministic after the steward fix.

## Static checks

```text
PASS Python ast.parse for contracts/TenderFit.py
PASS V2 attestation storage and deterministic gate review
PASS semantic-only [] path present
PASS frontend V2 material editor / attestation desk / proof rendering present
PASS frontend copy mirrors verify → qualify → award execution order
PASS duplicate in-hero Built on GenLayer lockup removed
```

## Frontend verification — PASS

Observed after the runtime suite:

```text
PASS local npm production build
PASS local UI load against canonical contract
PASS Vercel live render
PASS Vercel procurement #1 read
PASS material requirement + accepted attester rendering
PASS bid #1 qualified state + attestation proof chip rendering
PASS Attestation Desk rendering
PASS canonical contract address displayed
```

Live dApp:  
https://tender-fit.vercel.app/
