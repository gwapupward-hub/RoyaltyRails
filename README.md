# RoyaltyRail

**Programmable rights and royalty settlement on Solana.**

> Agree once. Get paid automatically.

RoyaltyRail turns approved revenue-sharing agreements into deterministic payment instructions. The protocol is being designed for music royalties first, with a generic settlement core that can expand to other creator and revenue-sharing workflows.

## Status

**Pre-mainnet / Phase 1 — Reference Accounting Engine**

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
- No admin withdrawal path for participant funds
- 0% protocol settlement fee during initial rollout

## Engineering sequence

1. Reference Accounting Engine
2. Protocol specification
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
