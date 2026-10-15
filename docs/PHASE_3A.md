# RoyaltyRail Phase 3A — Anchor Foundation and Rust Parity

Status: in progress  
Started: 2026-10-15

## Objective

Implement the frozen RoyaltyRail v1 economic contract in Rust before any instruction can move USDC.

Phase 3A deliberately excludes funding, Royalty Inbox token CPI, participant claims, and lifecycle mutation instructions.

## Pinned toolchain

- Anchor CLI / `anchor-lang`: **1.2.1**
- Solana CLI / Agave tooling requirement: **4.1.2**
- Rust host toolchain: **1.89.0**
- Node remains the repository's existing 22.x line until the JS CI pin is separately tightened.

Anchor 1.2.1 is the current new-project line selected for RoyaltyRail. The workspace initially uses Anchor's default Solana-v3 crate feature set; moving the Rust dependency graph to Anchor's optional `solana-v4` feature is a separate reviewed change, not an implicit upgrade.

## Stage 3A sequence

1. Workspace/toolchain scaffold.
2. Pure Rust share-domain and canonical-authority validation.
3. Pure Rust overflow-safe cumulative entitlement/residual math.
4. Port the complete bounded-error allocator.
5. Port agreement-hash and allocation-commitment encodings.
6. Match every canonical TypeScript vector, including the deterministic 100-case corpus.
7. Add PDA derivation golden vectors.
8. Add account serialized-size assertions.
9. Commit `Cargo.lock` and require locked Rust CI.
10. Run `cargo fmt`, `cargo clippy -D warnings`, Rust tests, TypeScript tests, and cross-language parity in CI.

## Hard gate

Phase 3B cannot begin until Rust reproduces the frozen TypeScript reference exactly and all Phase 3A CI checks are green.

No token-transfer instruction is allowed in this phase.

## Program ID policy

The program ID currently present in `Anchor.toml` and `programs/royaltyrail/src/lib.rs` is a temporary compile-time development ID only. It has no deployment authority/keypair associated with it.

Before the first local-validator or devnet deployment:

1. generate the RoyaltyRail program keypair through the pinned Anchor toolchain;
2. run `anchor keys sync`;
3. commit only the public program ID configuration required by the project;
4. never commit deployment private keys;
5. freeze the devnet program ID once integration testing begins.
