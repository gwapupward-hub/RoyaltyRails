# RoyaltyRail v1 Integration & UX Contract

Status: pre-beta product/integration specification  
Date: 2026-10-15

## 1. Goal

RoyaltyRail should feel like royalty infrastructure, not like a blockchain demo.

A creator should understand the product without learning PDAs, ATAs, SPL Token internals, compute budgets, or transaction-version details. An integrator should be able to adopt RoyaltyRail without trusting RoyaltyRail's hosted backend as an economic authority.

## 2. Integration modes

### Mode A — Studio-managed creator flow

Best for artists, producers, writers, managers and small labels.

```text
Create work/pool
→ draft split off-chain
→ invite collaborators
→ review deterministic manifest
→ approve terms + choose payout wallet
→ activate
→ display Royalty Inbox + API options
→ automate allocation + claims
```

### Mode B — Direct protocol/API funding

Best for distributors, labels, platforms and programmatic treasuries.

```text
fund_and_allocate(amount, nonce, payment_reference)
```

Benefits:

- one deterministic transaction for funding + economic allocation;
- explicit reconciliation reference;
- no recipient accounts required in the funding transaction;
- claims can execute independently afterward.

### Mode C — Address-only Royalty Inbox

Best for legacy payers that can only send USDC to one address.

```text
USDC transfer → Royalty Inbox
keeper/user → allocate_inbox()
keeper/user → participant claims
```

This mode is operationally simple but offers weaker payer-side intent/idempotency metadata than Mode B.

## 3. Five-minute creator benchmark

For a basic split:

```text
1. Name the work
2. Choose what revenue is being split
3. Add participants
4. Set percentages
5. Review 100% total
6. Invite participants
7. Participants review + approve
8. Agreement activates
```

Normal UI terminology:

- Split
- Agreement
- Collaborator
- Percentage
- Payout wallet
- Royalty Inbox
- Earnings
- Paid
- Pending

Avoid surfacing protocol jargon unless the user opens developer/advanced details.

## 4. Participant approval UX

Before signing, participant sees:

```text
Work
Revenue pool
Their role
Their percentage
All participants + percentages
Current version / predecessor
Settlement asset
Public-chain disclosure
Payout wallet they are selecting
Human-readable terms/document links
```

The UI MUST independently recompute:

```text
terms_hash
agreement_hash
```

and compare with on-chain state before requesting approval.

A continuing participant in an amendment may need both:

```text
approve new terms
approve supersession of old terms
```

Studio should compose both protocol instructions into one user transaction whenever possible and explain the action as one amendment approval.

## 5. Fee sponsorship

Participant onboarding should not require the participant to already own SOL.

Solana supports a fee payer distinct from the token/authorization signer. RoyaltyRail Studio may sponsor transaction fees for:

- agreement approval;
- supersession consent;
- payout-wallet rotation;
- participant claim;
- ATA preparation.

Fee sponsorship changes who pays network fees, not who authorizes economic actions.

The user must still sign any instruction requiring their participant authority.

## 6. Payout-wallet selection

Payout wallet is participant-controlled.

Studio should default to the connected participant wallet when appropriate but allow a different destination for:

- treasury wallets;
- smart wallets;
- custodians;
- business accounts;
- estate/entity structures.

Before saving a destination, Studio should:

- validate Solana public-key format;
- display checksum-style shortened confirmation;
- show the full address on an explicit confirmation surface;
- warn that payout rotation becomes effective once its transaction is finalized;
- offer to create the canonical USDC ATA if absent.

Do not imply that RoyaltyRail can recover funds sent to a participant-selected wrong destination.

## 7. Missing recipient ATA

A missing payout ATA must not block revenue allocation or other participants.

Studio/SDK may compose:

```text
createAssociatedTokenAccountIdempotent
claim_participant
```

for the same recipient in one user operation when transaction constraints permit.

If that combined transaction fails, the participant's claim remains intact and retryable.

## 8. Automatic payout experience

The protocol uses independent claims for liveness, but the product can still feel automatic.

RoyaltyRail's keeper service should:

1. watch successful allocations;
2. calculate claimable participants from on-chain state;
3. ensure recipient ATAs exist where appropriate;
4. submit independent claim transactions;
5. retry transient failures;
6. leave failed participant claims untouched;
7. surface actionable status rather than blocking other recipients.

Protocol correctness must not depend on this keeper.

Third parties may run equivalent keepers.

## 9. Claim status model

Per participant, Studio/API should distinguish:

```text
ALLOCATED
CLAIMABLE
CLAIM_SUBMITTED
PAID
DESTINATION_MISSING
DESTINATION_FROZEN_OR_UNUSABLE
CLAIM_PAUSED
```

Do not label an allocation “paid” until the claim transfer is confirmed.

## 10. Direct-funding SDK contract

Recommended high-level helper:

```text
fundAndAllocate({
  agreement,
  amount,
  paymentReference,
  sourceTokenAccount?,
  payerAuthority,
  feeSponsor?
})
```

SDK responsibilities:

- fetch current direct-funding nonce;
- verify agreement eligibility;
- verify configured settlement mint/token program;
- verify source token authority/mint;
- build exact instruction;
- handle fee sponsorship when configured;
- confirm outcome;
- return allocation sequence/commitment and transaction signature.

## 11. Direct-funding retry/idempotency discipline

The on-chain direct nonce prevents replay of the same nonce, but `payment_reference` is not a global uniqueness set.

SDK/API retry rule:

- retain the same business `payment_reference` across retries;
- if transaction status is uncertain, resolve the previous signature/reference before fetching a fresh nonce and generating a new payment;
- never blindly retry a business payment with a new nonce merely because an RPC timed out;
- expose explicit `UNKNOWN_CONFIRMATION` rather than risking duplicate funding.

Enterprise API should provide an off-chain idempotency layer keyed by the customer's payment ID.

A future optional on-chain idempotency receipt mode may be added if enterprise demand justifies rent/state costs.

## 12. Plain Royalty Inbox safety

An address-only deposit is intentionally simple and therefore less expressive.

UI/API must warn payers:

> A direct token transfer to a Royalty Inbox is irreversible at the protocol layer once allocated. Verify agreement version, mint, network and address before sending.

Recommended safeguards:

- network badge (`mainnet`, `devnet`);
- agreement version displayed beside address;
- USDC-only warning;
- QR/payment URI encoding where applicable;
- minimum/maximum UI sanity checks;
- copy-address confirmation;
- optional memo/reference instructions for off-chain reconciliation;
- small test payment option for first-time large payers.

RoyaltyRail v1 deliberately does not add an admin refund backdoor for mistaken deposits.

## 13. Wrong-version payment risk

Every version has a distinct Royalty Inbox.

This protects historical accounting but means a payer must intentionally choose which terms govern a payment.

Integrator UX should display:

```text
Agreement v3 — ACTIVE
Agreement v2 — SUPERSEDED / historical payments only
```

For API funding, version selection is explicit.

Future statement ingestion may recommend a version based on accounting period, but must not silently guess when evidence is ambiguous.

## 14. Negative adjustments / corrected statements

V1 has no clawbacks or negative allocations.

Distributor integrations MUST net negative corrections before funding distributable revenue.

If a corrected external statement says an earlier payment was too large, RoyaltyRail v1 does not seize previously claimed participant funds.

Studio/API should surface the discrepancy for commercial resolution rather than mutating historical on-chain allocations.

## 15. Unresolved/conflicting splits

RoyaltyRail v1 is a settlement protocol for **resolved payment instructions**.

It is not a rights-conflict adjudicator.

If shares are unknown, disputed, under-claimed or over-claimed, Studio should not manufacture a 100% executable split. The agreement should remain off-chain/draft until the parties define a valid 100,000,000-share-unit settlement configuration.

A future suspense/dispute module may isolate disputed revenue without weakening deterministic v1 agreements.

## 16. One-recipient versions

V1 supports 1–16 participants.

A 100% single-recipient agreement is useful for:

- rights buyouts;
- catalog/entity consolidation;
- estate/successor arrangements;
- a collaborator's full exit after unanimous supersession consent;
- standardized infrastructure even when no split is currently needed.

## 17. More than 16 beneficiaries

V1 caps a single agreement version at 16 participants for predictable account/compute/transaction behavior.

Do not silently truncate larger splits.

Options for later versions:

- higher-cap account layout after benchmarks;
- hierarchical/group payout structures;
- enterprise aggregation entities;
- specialized large-rightsholder settlement accounts.

Recursive routing between protocol-controlled destinations must be threat-modeled before being promoted as an official composition feature because cycles can create pathological routing behavior.

## 18. Transaction-format compatibility

SDK should choose the least demanding Solana transaction format that safely fits the operation.

Do not require v1-format transactions merely because they are available.

If v1 transactions are used, SDK must set their message resource configuration explicitly and ensure downstream RPC/wallet/indexer support.

Max-participant proposal, approval composition, ATA-create+claim, and enterprise funding flows require measured transaction-size/compute benchmarks during Phase 3/devnet.

## 19. Webhooks

Suggested API/webhook events:

```text
agreement.proposed
agreement.participant_approved
agreement.supersession_approved
agreement.rejected
agreement.activated
agreement.superseded
participant.payout_wallet_updated
revenue.deposit_observed
revenue.allocated
participant.claimable
participant.claim_submitted
participant.paid
participant.claim_failed
protocol.pause_changed
```

Every webhook should carry:

- stable event ID;
- deployment/network;
- relevant account address;
- transaction signature + slot when on-chain;
- schema version;
- replay-safe delivery semantics for the off-chain API.

Consumers must be able to reconstruct authoritative economic state from chain data without trusting webhook delivery.

## 20. Observability

Production integration should monitor:

- Royalty Inbox balances;
- unallocated balance;
- allocated-unclaimed liability;
- claimable balances;
- failed claims and cause;
- stale pending agreements;
- direct nonce conflicts;
- allocation sequence gaps in indexer ingestion;
- program upgrade/ProgramData changes;
- pause state;
- keeper health;
- RPC divergence/finality.

## 21. API versioning

Protocol schema, SDK, API and webhooks require independent explicit versions.

Example:

```text
protocol: v1
manifest: royaltyrail/agreement-manifest/v1
SDK: semver
API: /v1
webhook schema: 1
```

An API update must not silently reinterpret an existing on-chain agreement.

## 22. DDEX adapter strategy

DDEX adapters belong above the settlement core.

RoyaltyRail should map established work/party/right identifiers into the Manifest/indexer model, then produce the same deterministic settlement instructions.

This preserves a small auditable Solana program while allowing richer music-industry interoperability to evolve independently.

## 23. Developer adoption promise

A third-party integrator should be able to use RoyaltyRail with:

1. protocol ID + published IDL;
2. open-source deterministic SDK;
3. canonical hash/allocation vectors;
4. documented PDA derivations;
5. manifest schema;
6. webhook/API layer as optional convenience;
7. no proprietary backend needed to verify balances or settlement correctness.

That is the standard RoyaltyRail should meet before calling itself a protocol rather than an app feature.
