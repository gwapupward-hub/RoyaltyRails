# RoyaltyRail

**Programmable rights and royalty settlement on Solana.**

> Agree once. Get paid automatically.

RoyaltyRail turns approved revenue-sharing agreements into deterministic revenue allocations and independently claimable USDC payouts. It is designed for music royalties first, with a generic settlement core that can later support other creator and revenue-sharing workflows.

## Status

**Pre-mainnet / Phase 2 — Protocol Specification Hardening**

Phase 1 is merged: the blockchain-independent TypeScript allocation engine is the canonical economic source of truth.

Phase 2 is undergoing a pre-merge security/architecture audit before Anchor implementation begins.

RoyaltyRail is not production-ready and must not be used to custody or settle real royalties.

## Hardened V1 direction

- Solana
- Native USDC settlement
- Percentage-based revenue pools
- 100,000,000-share-unit accounting
- 1–16 participants
- Unanimous participant approval
- Replacement versions require consent from both old and new participant sets
- Immutable economic terms per version
- Participant-controlled payout-wallet rotation
- Revenue allocation separated from token claiming
- Permissionless Royalty Inbox allocation
- Permissionless per-participant claims
- One broken/frozen recipient cannot block other recipients
- Canonical deployment-scoped agreement/allocation commitments
- Deterministic human-readable Agreement Manifest
- No admin withdrawal or payout override path
- Governance/guardian pause separation
- 0% protocol settlement fee during initial rollout

## Why allocate then claim?

A push-only multi-recipient transaction creates a shared failure domain: one missing or frozen recipient token account can make the whole transaction fail.

RoyaltyRail instead performs:

```text
USDC arrives
   ↓
Revenue allocated by approved percentages
   ↓
Each participant has independent claimable USDC
   ↓
Anyone may trigger that participant's claim
```

RoyaltyRail Studio/keepers can push claims automatically, preserving the normal user experience while keeping protocol liveness isolated per recipient.

## Participant security model

Economic terms and payout routing are intentionally separate.

A participant's authority, percentage and role are part of immutable agreement economics. The payout wallet is that participant's own routing state and may be rotated without group approval.

A manager cannot remove an existing participant in a replacement agreement without that participant consenting to supersession.

## Specification

- [`docs/ACCOUNTING_V1.md`](docs/ACCOUNTING_V1.md) — pure canonical allocation math
- [`docs/PROTOCOL_V1.md`](docs/PROTOCOL_V1.md) — Solana accounts/instructions/allocation/claim specification
- [`docs/STATE_MACHINE_V1.md`](docs/STATE_MACHINE_V1.md) — agreement, supersession, allocation and claim lifecycle
- [`docs/SECURITY_V1.md`](docs/SECURITY_V1.md) — trust boundaries, threat model and mainnet gate
- [`docs/ACCOUNT_LAYOUT_V1.md`](docs/ACCOUNT_LAYOUT_V1.md) — serialization and size bounds
- [`docs/AGREEMENT_MANIFEST_V1.md`](docs/AGREEMENT_MANIFEST_V1.md) — deterministic human-readable agreement representation
- [`docs/INTEGRATION_UX_V1.md`](docs/INTEGRATION_UX_V1.md) — adoption, SDK, fee sponsorship, keepers and operational UX
- [`docs/PREMERGE_AUDIT_V1.md`](docs/PREMERGE_AUDIT_V1.md) — findings that hardened the v1 design

## Engineering sequence

1. ✅ Reference Accounting / Allocation Engine
2. **Protocol specification hardening — current**
3. Anchor implementation
4. SDK + indexer
5. RoyaltyRail Studio
6. Devnet adversarial testing
7. Independent security + legal architecture review
8. Controlled mainnet beta

## Repository naming

The product name is **RoyaltyRail** (singular). This repository currently retains the `RoyaltyRails` GitHub slug; source packages, documentation, protocol identifiers, and branding use the singular product name.

## Integration philosophy

RoyaltyRail should be useful without requiring integrators to trust RoyaltyRail's hosted backend.

Canonical SDK helpers should cover:

- address derivation
- Agreement Manifest canonicalization/hashing
- agreement hashing
- approval/supersession flows
- direct funding
- inbox allocation
- participant claiming
- payout-wallet rotation
- allocation commitment verification
- reconciliation references

A third party should be able to independently verify every economic result from public protocol state and the published reference implementation.

## Music-industry interoperability

RoyaltyRail is being designed so richer music metadata and future DDEX adapters live above the small settlement core. The protocol handles approved executable payment instructions; it does not pretend to adjudicate unresolved rights claims.

## Privacy

V1 is public-chain infrastructure. Participant authorities, percentages, allocations, claims and token flows are publicly observable.

RoyaltyRail does not claim confidential royalty splits in v1.

## Safety

No contract, address, API or economic output in this repository should be treated as production settlement infrastructure until explicit security, legal, deployment and mainnet-readiness gates are complete.

## License

License and contribution policy will be finalized before public production release.
