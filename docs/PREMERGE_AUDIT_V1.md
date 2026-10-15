# RoyaltyRail v1 Pre-Merge Architecture & Security Audit

Status: blocking review before Protocol Specification v1 merge
Date: 2026-10-15

This review attacks the v1 design from adversarial, operational, integration, and user-experience perspectives before any Anchor program is written.

## Executive conclusion

The original Phase 2 draft has a strong deterministic accounting foundation, but three design issues are serious enough to fix before specification freeze:

1. **Replacement-consent gap** — a replacement version only required approval from participants listed in the replacement, which could permit an existing participant to be removed without approving their own removal.
2. **Push-only liveness risk** — one missing or frozen recipient USDC account could cause an otherwise valid multi-recipient settlement to fail atomically for every participant.
3. **Immutable payout-routing risk** — payout wallets were part of the immutable agreement hash, so a participant could not rotate a compromised, frozen, or obsolete destination without requiring a full group amendment.

The hardened v1 architecture separates **economic agreement**, **revenue allocation**, and **payout routing**.

## Hardened model

```text
Revenue arrives
     |
     v
Royalty Inbox
     |
     | permissionless allocation
     v
Agreement accounting
     |
     +--> Participant A claimable
     +--> Participant B claimable
     +--> Participant C claimable
     |
     | permissionless independent claims
     v
Recipient USDC ATAs
```

Revenue is allocated immediately according to the approved economic agreement. Actual token delivery is independently claimable for each participant so one broken destination cannot block the rest.

RoyaltyRail Studio and third-party keepers may automatically call claims so the normal user experience remains "money arrives, recipients get paid" without making protocol liveness depend on every recipient account being healthy in the same transaction.

## A-001 — Replacement consent

### Finding

If version 1 contains Alice, Bob, and Carol, a malicious manager could propose version 2 containing only Alice and Bob. If activation only checks approvals from version 2 participants, Carol never signs the agreement that removes her.

### Required correction

A replacement version must satisfy **two independent consent sets**:

- unanimous approval from all participants in the proposed new version; and
- unanimous supersession consent from all participants in the currently active predecessor version.

A removed participant therefore retains veto power over removal from the current agreement. Added participants must affirmatively accept their new terms.

Continuing participants may satisfy both consent requirements in one Studio action containing multiple protocol instructions.

## A-002 — Payout wallet ownership

### Finding

A payout destination is operational routing, not the economic right itself. Binding the payout wallet permanently into the agreement hash creates unnecessary risk.

### Required correction

The immutable agreement hash binds:

- participant authority;
- share BPS;
- role code;
- settlement basis;
- revenue-pool semantics;
- terms hash;
- predecessor relationship;
- deployment domain.

It does **not** bind the participant's current payout wallet.

Each participant selects their own payout wallet when approving. The participant authority may later rotate only that participant's payout wallet without changing shares, rights, or any other participant's state.

Payout rotation must:

- require the participant authority signer;
- reject the zero/default pubkey;
- increment a payout revision counter;
- emit an auditable event;
- remain available on Active and Superseded versions while claimable funds remain.

## A-003 — Allocate then claim

### Finding

Push-only multi-transfer settlement creates a shared failure domain. A frozen token account cannot receive SPL-token transfers. One unhealthy destination can therefore revert a transaction intended to pay every recipient.

### Required correction

V1 settlement becomes two logical stages:

1. **Allocate revenue** according to the canonical accounting engine.
2. **Claim allocated revenue** independently per participant.

For each participant:

```text
claimable_i = cumulative_allocated_i - cumulative_claimed_i
```

The Royalty Inbox balance is divided conceptually into:

```text
allocated-but-unclaimed + newly deposited/unallocated
```

Required invariant:

```text
inbox_balance >= cumulative_gross - sum(cumulative_claimed)
```

For plain external deposits:

```text
new_unallocated = inbox_balance - (cumulative_gross - sum(cumulative_claimed))
```

`allocate_inbox()` allocates exactly `new_unallocated`.

A successful claim reduces both the inbox token balance and the participant's claimable amount by the same quantity, so it does not change the amount of unallocated revenue.

This design allows allocation and claims to safely interleave under Solana account locking.

## A-004 — Direct funding

`fund_and_allocate(amount, expected_nonce, payment_reference)` transfers configured USDC from a payer-owned source token account to the Royalty Inbox and allocates that exact amount in the same transaction.

The payer source account does not need to be the payer's ATA. It must:

- be owned by the configured original SPL Token Program;
- hold the configured settlement mint;
- have the transaction/CPI signer as its token authority.

This preserves safety while supporting treasury, custody, smart-wallet, and programmatic integrations that use non-ATA source accounts.

Delegated-source authority support is deferred until explicitly specified and tested.

## A-005 — Reconciliation reference

Direct funding includes a 32-byte `payment_reference`.

The reference is:

- included in the allocation event/commitment;
- intended for statement, invoice, distributor-batch, or external payment correlation;
- not itself an idempotency key in v1;
- allowed to be all-zero when no external reference exists.

Plain deposits may carry Solana memo/reference data that indexers can associate with the inbound transaction. An inbox allocation may aggregate multiple inbound deposits and therefore cannot truthfully claim one caller-supplied payment reference.

## A-006 — Canonical allocation commitment

The former payout commitment becomes an **allocation commitment**.

It commits to the economic allocation produced at allocation time:

```text
deployment_id
agreement_pubkey
allocation_sequence
allocation_mode
gross_amount
payment_reference
participant_count
for each participant:
    participant_authority
    allocation_amount
```

The current payout wallet is intentionally excluded because payout routing may later rotate.

A separate `PayoutClaimed` event records the destination wallet and amount used for each actual token transfer.

## A-007 — Deployment domain separation

`ProtocolConfig` receives an immutable non-zero 32-byte `deployment_id` at initialization.

The deployment ID is included in agreement and allocation commitments to prevent identical-looking commitments across independent deployments/clusters that happen to reuse program identifiers and test data.

## A-008 — Management vs economics

The protocol manager may propose economic terms but cannot unilaterally activate them.

Management-key continuity and transfer are important but must not weaken participant consent. V1 implementation should either:

- use a multisig/smart-wallet manager from inception; or
- implement a separately reviewed two-step management-authority transfer that does not modify participant economics.

This remains a Phase 3 implementation decision and may not silently change the economic consent model.

## A-009 — Admin/guardian separation

Production should separate:

- **governance authority** — hardened multisig controlling durable protocol configuration permitted by v1; and
- **guardian authority** — operational circuit-breaker authority permitted to pause, but not move funds or modify agreements.

A guardian compromise must not become a fund-redirection compromise.

Upgrade authority remains a separate deployment-layer trust boundary and must be protected by multisig/timelock governance before meaningful mainnet value is accepted.

## A-010 — Account-layout evolution

All long-lived RoyaltyRail-owned accounts should reserve zeroed padding bytes in v1. This allows future non-economic fields to be introduced without immediately requiring account reallocation/migration.

Reserved bytes:

- are zeroed at initialization;
- are ignored by v1;
- are not part of agreement economics unless a future schema explicitly defines them;
- may only be interpreted under a future schema-version migration reviewed for backward compatibility.

## A-011 — Public-data limitation

V1 agreement authorities, shares, and on-chain flows are public.

This must be clear in Studio before users approve an agreement. Dedicated wallets can reduce casual identity linkage but do not provide cryptographic financial privacy.

Private/confidential split terms are a separate protocol problem and must not be falsely implied by the v1 product.

## A-012 — Electronic-signature evidence

A wallet approval is strong cryptographic evidence of control and protocol assent, but RoyaltyRail must not assume that one on-chain transaction alone satisfies every jurisdiction's electronic-signature, record-retention, disclosure, tax, or entertainment-contract requirement.

RoyaltyRail Studio should generate an off-chain evidence package containing at minimum:

- exact agreement hash;
- human-readable agreement manifest/version;
- participant acknowledgement and intent records;
- timestamps;
- transaction signatures;
- relevant terms/document hashes;
- exportable audit history.

Legal enforceability remains subject to qualified counsel and applicable law.

## A-013 — Human-readable agreement manifest

Before public beta, RoyaltyRail should publish a versioned, deterministic Agreement Manifest schema so integrators can render the same human-readable terms from the same economic data.

The manifest should support music-first identifiers and later DDEX mapping without placing sensitive PII on-chain.

At minimum it should define:

- work/release identifiers;
- revenue-pool description;
- settlement basis;
- participant display metadata and roles;
- shares;
- effective-period metadata;
- external agreement/document references;
- amendment/version information;
- payment-source/reconciliation metadata.

The on-chain `terms_hash` anchors the chosen manifest/document package.

## A-014 — Direct-settlement contention

A single agreement-wide direct nonce provides simple replay/race protection but serializes concurrent direct funders. V1 may retain this conservative model if the SDK automatically reads/retries the current nonce.

Before enterprise scale, benchmark alternatives such as payer-scoped nonces or explicit idempotency receipt accounts. Do not silently treat `payment_reference` as replay protection.

## A-015 — Upgrade trust

Application-level "no admin withdrawal" guarantees are only as strong as deployed bytecode while the program remains upgradeable.

Mainnet trust policy must include:

- verifiable builds;
- published deployed program ID;
- monitored ProgramData changes;
- multisig-controlled upgrade authority;
- explicit upgrade delay/timelock policy for normal upgrades;
- emergency process;
- long-term decision on making a mature audited release immutable.

## Merge blockers

Before PR #2 may be treated as the v1 protocol freeze, the normative specification must reflect:

- predecessor/supersession consent;
- participant-controlled payout routing;
- allocate-then-claim settlement;
- deployment-domain separation;
- direct payment reference semantics;
- allocation vs claim events/commitments;
- revised security invariants/account layout.

Other findings may remain documented roadmap items, but these core semantics must not be left ambiguous for the Anchor implementation.
