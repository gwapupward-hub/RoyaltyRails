# RoyaltyRail

**Programmable rights and royalty settlement on Solana.**

> Agree once. Get paid automatically.

RoyaltyRail turns approved revenue-sharing agreements into deterministic payment instructions. The protocol is being designed for music royalties first, with a generic settlement core that can expand to other creator and revenue-sharing workflows.

## Status

**Pre-mainnet / Phase 2 — Protocol Specification**

Phase 1 is merged: the blockchain-independent TypeScript reference accounting engine is the canonical economic source of truth.

Phase 2 freezes the Solana protocol surface before Anchor implementation: accounts, PDAs, agreement lifecycle, approvals, USDC settlement, Royalty Inbox behavior, canonical hashing, authority boundaries, events, replay protection, pause behavior and security invariants.

RoyaltyRail is not yet production-ready and must not be used to custody or settle real royalties.

## V1 direction

- Solana
- Native USDC settlement
- Percentage-based revenue pools
- 10,000-BPS share accounting
- Unanimous participant approval
- Immutable, versioned agreements
- Direct atomic settlement
- Permissionless Royalty Inbox settlement
- Deterministic cumulative rounding
- Canonical agreement and payout commitments
- No admin withdrawal path for participant funds
- 0% protocol settlement fee during initial rollout

## Specification

- [`docs/ACCOUNTING_V1.md`](docs/ACCOUNTING_V1.md) — canonical economic behavior
- [`docs/PROTOCOL_V1.md`](docs/PROTOCOL_V1.md) — Solana account/instruction/settlement specification
- [`docs/STATE_MACHINE_V1.md`](docs/STATE_MACHINE_V1.md) — agreement and version lifecycle
- [`docs/SECURITY_V1.md`](docs/SECURITY_V1.md) — trust boundaries, threat model and mainnet gate

## Engineering sequence

1. ✅ Reference Accounting Engine
2. **Protocol specification — in progress**
3. Anchor implementation
4. SDK + indexer
5. RoyaltyRail Studio
6. Devnet adversarial testing
7. Independent security + legal architecture review
8. Controlled mainnet beta

## Repository naming

The product name is **RoyaltyRail** (singular). This repository currently retains the `RoyaltyRails` GitHub slug; source packages, documentation, protocol identifiers, and branding use the singular product name.

## Safety

This repository is under active development. No contract, address, API, or economic output in this repository should be treated as production settlement infrastructure until the project has completed its explicit security, legal, and mainnet-readiness gates.

## License

License and contribution policy will be finalized before public production release.
