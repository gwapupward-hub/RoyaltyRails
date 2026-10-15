# RoyaltyRail v1 Pre-Merge Architecture & Security Audit

Status: hardened findings implemented; final CI/consistency verification required  
Date: 2026-10-15

This review attacked the v1 design from adversarial, operational, integration, real-world royalty, and user-experience perspectives before any Anchor program is written.

## Executive conclusion

The original Phase 2 draft had a strong deterministic accounting foundation but several architecture issues were serious enough to block merge. The v1 specification has now been redesigned around three independent layers:

```text
Economic agreement
      ↓
Revenue allocation
      ↓
Payout routing / claims
```

The hardened design protects participant economics while reducing shared failure domains and making integration easier.

## A-001 — Replacement-consent gap — RESOLVED

### Original risk

A manager could propose a replacement that omitted an existing participant. If only the proposed participants had to sign, the omitted participant could be removed without consenting.

### Resolution

Replacement activation now requires:

- unanimous approval from all participants in the proposed version; and
- unanimous supersession consent from all participants in the current Active predecessor to the exact new agreement hash.

A removed participant therefore retains veto power over removal. Continuing participants may perform both consent actions in one Studio transaction.

## A-002 — Immutable payout routing — RESOLVED

### Original risk

Binding payout wallet into immutable economic terms would force a whole-group amendment if one participant's destination became compromised, obsolete or unusable.

### Resolution

Core economic agreement binds:

```text
participant authority
share BPS
```

Payout wallet is participant-controlled routing state and is excluded from agreement hash.

Only the participant authority may rotate their payout wallet. Rotation increments an auditable revision and changes no economic rights.

## A-003 — Push-only settlement liveness — RESOLVED

### Original risk

One missing/frozen/unusable recipient token account could revert a transaction intended to pay everyone.

### Resolution

V1 uses allocation followed by independent claims:

```text
Revenue arrives
     ↓
Royalty Inbox
     ↓
permissionless allocation
     ↓
claimable participant balances
     ↓
independent permissionless claims
```

A failed participant claim cannot block another participant.

Studio/keepers can automatically push claims so normal UX still feels automatic.

## A-004 — Direct funding semantics — RESOLVED

`fund_and_allocate(amount, expected_nonce, payment_reference)` transfers configured USDC from a payer-authorized source token account into the Royalty Inbox and allocates that exact amount atomically.

Source token account need not be ATA, but must use configured token program/mint and have payer signer as token authority. Delegated-source support is deferred.

## A-005 — Reconciliation reference — RESOLVED

Direct funding includes a 32-byte `payment_reference` used for invoice, statement, distributor-batch, or external payment correlation.

It is not protocol-level replay protection or uniqueness state.

Inbox allocation uses zero reference because one allocation may aggregate several plain deposits.

## A-006 — Allocation commitment — RESOLVED

The commitment records **economic allocation**, not current payout destinations:

```text
deployment_id
agreement_pubkey
allocation_sequence
allocation_mode
gross_amount
payment_reference
participant_count
participant_authority + allocation_amount
```

Actual token delivery is separately recorded through `PayoutClaimed` events.

## A-007 — Deployment domain separation — RESOLVED

ProtocolConfig has immutable non-zero `deployment_id` included in agreement and allocation commitments.

## A-008 — Manager continuity vs economics — RESOLVED AT SPEC LEVEL

Work/RevenuePool management uses two-step transfer. Manager may create metadata/proposals but cannot alter activated economics, bypass consent, redirect payouts, or withdraw participant funds.

## A-009 — Governance/guardian separation — RESOLVED AT SPEC LEVEL

Guardian may only pause. Governance may pause/unpause and rotate guardian. Neither may move funds or edit participant economics.

Program upgrade authority remains a separate deployment-layer threat requiring hardened multisig/governance, upgrade-delay policy, monitoring and verifiable builds before mainnet.

## A-010 — Account evolution — RESOLVED

Long-lived RoyaltyRail accounts reserve zeroed padding bytes. V1 instructions do not interpret them. Any future interpretation requires explicit schema-version migration and may not rewrite existing economics.

## A-011 — Public-chain privacy limitation — DOCUMENTED

Authorities, shares, allocations, claims and token flows are public. V1 does not claim confidential royalty splits.

Sensitive PII remains off-chain.

## A-012 — Electronic-signature evidence — PRODUCT GATE

Wallet approval is strong cryptographic evidence of authority/control but is not represented as universally satisfying every jurisdiction's e-signature/record-retention rules.

Studio must export an evidence package linking:

- canonical Agreement Manifest;
- terms hash;
- agreement hash;
- participant approvals;
- predecessor supersession approvals;
- activation transaction;
- timestamps/document hashes;
- settlement history.

Qualified legal review remains a pre-mainnet requirement.

## A-013 — Deterministic Agreement Manifest — RESOLVED AT SPEC LEVEL

`AGREEMENT_MANIFEST_V1.md` defines a canonical JCS-hashed human-readable agreement artifact anchored through `terms_hash`.

Detailed creative roles/credits live here rather than as singular on-chain role codes.

## A-014 — Direct-funding contention — ACCEPTED V1 TRADEOFF

One agreement-wide direct nonce may serialize concurrent direct funders. The SDK must refresh/retry nonce conflicts safely.

Payer-scoped nonces or idempotency receipt PDAs remain scale-driven future options.

## A-015 — Upgrade trust — MAINNET GATE

Application-level no-withdraw invariants remain dependent on deployed bytecode while upgradeability exists.

Mainnet requires hardened upgrade governance, timelock/delay policy, verifiable builds and ProgramData monitoring.

## A-016 — Economic engine mixed with replay state — RESOLVED

### Original risk

The Phase 1 engine carried a direct-settlement nonce, but inbox allocation must use identical percentage math without consuming that nonce.

### Resolution

The canonical TypeScript engine is now pure economic allocation math:

```text
agreement shares
cumulative allocation state
new amount
        ↓
allocation vector + next economic state
```

Direct replay protection exists only in the Solana protocol wrapper.

## A-017 — Single-recipient versions — RESOLVED

The original 2-recipient minimum blocked legitimate cases such as full assignments, catalog/entity consolidation, estates, or a collaborator's unanimously consented exit.

V1 now supports 1–16 participants. One participant must hold 10,000 BPS.

## A-018 — Creative role coupling — RESOLVED

### Original risk

A single on-chain `role_code` could not accurately model one contributor holding multiple credits and would make evolving role vocabularies look like financial schema changes.

### Resolution

On-chain economic participant state no longer contains a role code.

Creative roles are multi-valued metadata in the canonical Agreement Manifest, protected through `terms_hash`. Solana enforces authority + share; music semantics remain interoperable above the settlement core.

## A-019 — Claim amount width — PROVED SAFE

Lifetime cumulative state uses `u128`, while SPL token transfers use `u64`.

The inbox solvency invariant proves:

```text
sum(current claimable) <= inbox_balance <= u64::MAX
```

Therefore each current participant claim necessarily fits `u64`; no claim-chunking mechanism is needed.

## A-020 — Negative royalty corrections — EXPLICIT V1 POLICY

V1 never creates negative allocations or claws back claimed funds.

External corrections/returns/chargebacks are netted before new distributable deposits or resolved commercially outside v1. Future offset/waterfall logic requires a separate consent and accounting model.

## A-021 — Unresolved/disputed rights — EXPLICIT V1 BOUNDARY

RoyaltyRail v1 executes resolved 10,000-BPS payment instructions. It does not adjudicate ownership disputes or manufacture missing shares.

Future suspense/dispute infrastructure may isolate unresolved revenue without adding administrator discretion to v1.

## A-022 — Wrong-version/raw deposit risk — DOCUMENTED + UX MITIGATION

Each AgreementVersion has its own Royalty Inbox. Raw transfers are irreversible at the protocol layer once allocated.

Studio/API must show network, native USDC, agreement version, address and amount clearly and encourage test transfers for unfamiliar large payments. Direct `fund_and_allocate` is preferred for programmatic integrations.

## A-023 — Transaction-format dependency — BENCHMARK GATE

RoyaltyRail will not require the newest Solana transaction format by default. Phase 3 benchmarks decide what each operation needs.

If v1 transactions are used, SDK must explicitly configure v1 message resources rather than assume legacy/v0 ComputeBudget behavior.

## A-024 — Data availability — BETA GATE

A hash proves integrity, not availability. Studio must allow export/recovery of exact canonical manifests/evidence without depending on one RoyaltyRail database.

## Final merge blockers

Before PR #2 is marked ready again:

- all normative docs must reflect the hardened architecture;
- no stale push-only/payout-commitment/role-code/2-recipient semantics may remain in the implementation target;
- TypeScript reference suite must pass on the final branch head;
- canonical agreement/allocation vectors must pass;
- PR description must be rewritten to describe the final architecture.

After those gates pass, Phase 2 may be treated as the frozen implementation contract for Phase 3 Anchor work.
