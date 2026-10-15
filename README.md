<p align="center">
  <img src="docs/brand/assets/royaltyrails-banner.svg" alt="RoyaltyRails — automated royalty and revenue splits" width="100%" />
</p>

# RoyaltyRails

**Programmable rights and royalty settlement on Solana.**

> Agree once. Get paid automatically.

RoyaltyRails turns approved revenue-sharing agreements into deterministic revenue allocations and independently claimable USDC payouts. It is designed for music royalties first, with a generic settlement core that can later support other creator and revenue-sharing workflows.

## Status

**Pre-mainnet / Phase 2 — Protocol Specification Hardening**

Phase 1 is merged: the blockchain-independent TypeScript allocation engine is the canonical economic source of truth.

Phase 2 is undergoing a pre-merge security/architecture audit before Anchor implementation begins.

RoyaltyRails is not production-ready and must not be used to custody or settle real royalties.

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

RoyaltyRails instead performs:

```text
USDC arrives
   ↓
Revenue allocated by approved percentages
   ↓
Each participant has independent claimable USDC
   ↓
Anyone may trigger that participant's claim
```

RoyaltyRails Studio/keepers can push claims automatically, preserving the normal user experience while keeping protocol liveness isolated per recipient.

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

## Brand system

The official RoyaltyRails visual identity, logo usage rules, repository-safe display assets, and implementation tokens live in [`docs/brand/`](docs/brand/README.md).

Canonical colors:

- Royalty Red — `#DD1313`
- Royal Gold — `#D4AF37`
- Accent Orange — `#F08A24`
- Background Black — `#000000`
- Surface Charcoal — `#0D0D0D`

## Engineering sequence

1. ✅ Reference Accounting / Allocation Engine
2. **Protocol specification hardening — current**
3. Anchor implementation
4. SDK + indexer
5. RoyaltyRails Studio
6. Devnet adversarial testing
7. Independent security + legal architecture review
8. Controlled mainnet beta

## Brand vs protocol naming

The public-facing product brand is **RoyaltyRails**. Existing v1 package names, protocol identifiers, and technical references that use the singular **RoyaltyRail** remain unchanged during protocol hardening to avoid unnecessary compatibility churn. A dedicated naming migration can be performed later if those identifiers should also become plural.

## Integration philosophy

RoyaltyRails should be useful without requiring integrators to trust RoyaltyRails' hosted backend.

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

RoyaltyRails is being designed so richer music metadata and future DDEX adapters live above the small settlement core. The protocol handles approved executable payment instructions; it does not pretend to adjudicate unresolved rights claims.

## Privacy

V1 is public-chain infrastructure. Participant authorities, percentages, allocations, claims and token flows are publicly observable.

RoyaltyRails does not claim confidential royalty splits in v1.

## Safety

No contract, address, API or economic output in this repository should be treated as production settlement infrastructure until explicit security, legal, deployment and mainnet-readiness gates are complete.

## License

License and contribution policy will be finalized before public production release.
