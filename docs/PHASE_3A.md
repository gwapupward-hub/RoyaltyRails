# RoyaltyRail Phase 3A — Anchor Foundation and Rust Parity

Status: implementation complete; final merge-candidate CI required  
Started: 2026-10-15

## Objective

Implement the frozen RoyaltyRail v1 economic contract in Rust before any instruction can move USDC.

Phase 3A deliberately excludes funding, Royalty Inbox token CPI, participant claims, and lifecycle mutation instructions.

## Pinned toolchain

- Anchor CLI / `anchor-lang`: **1.2.1**
- Solana CLI / Agave tooling requirement: **4.1.2**
- Rust host toolchain: **1.89.0**
- Node remains the repository's existing 22.x line until the JS CI pin is separately tightened.

Anchor 1.2.1 is the selected stable line. The workspace initially uses Anchor's default Solana-v3 crate feature set; moving the Rust dependency graph to Anchor's opt-in `solana-v4` feature is a separate reviewed change, not an implicit dependency migration.

## Implemented in this stage

- pure Rust share-domain and canonical-authority validation;
- overflow-safe cumulative proportional entitlement/residual math;
- complete bounded-error allocator with conservation and state validation;
- canonical agreement hash binary encoding + SHA-256 parity;
- canonical allocation commitment binary encoding + SHA-256 parity;
- deterministic named-vector and 100-case generated-corpus parity against the frozen TypeScript fixture;
- fixed PDA seed helpers and immutable derivation vectors;
- Anchor/Borsh serialized payload-size assertions, including the 2,036-byte maximum AgreementVersion account size;
- committed `Cargo.lock` and locked Rust dependency resolution;
- read-only CI gates for Rust formatting, clippy with `-D warnings`, tests, and TypeScript reference checks.

The Phase 3A Anchor crate intentionally contains **no `#[program]` instruction module**. `declare_id!`, PDA helpers, and serialization types are present, but the instruction surface begins only in Phase 3B. This avoids pretending that a no-op program is part of the frozen on-chain API and keeps Phase 3A free of token-moving or lifecycle behavior.

## Stage 3A sequence

1. Workspace/toolchain scaffold. ✅
2. Pure Rust share-domain and canonical-authority validation. ✅
3. Pure Rust overflow-safe cumulative entitlement/residual math. ✅
4. Port the complete bounded-error allocator. ✅
5. Port agreement-hash and allocation-commitment encodings. ✅
6. Match every canonical TypeScript vector, including the deterministic 100-case corpus. ✅
7. Add PDA derivation golden vectors. ✅
8. Add account serialized-size assertions. ✅
9. Commit `Cargo.lock` and require locked Rust CI. ✅
10. Run `cargo fmt`, `cargo clippy -D warnings`, Rust tests, TypeScript tests, and cross-language parity in CI. ✅

## Verified parity surface

The Rust implementation is required to reproduce the frozen TypeScript contract for:

- `100_000_000` total share units and 1–16 participants;
- raw 32-byte canonical authority ordering;
- bounded-error cumulative allocation and conservation;
- `u64` current allocation amounts and `u128` lifetime state;
- near-`u128::MAX` entitlement calculations without wider cumulative multiplication;
- canonical agreement hash `7c3864a1ad4ed61713d694523cd2737bc69ad81bd1428c72f5bd3dcba76b2032`;
- canonical allocation commitment `bbbb4c0ef0d9617c5427d85cf9828d5767689a59bd696324adde3e03d9316950`;
- all named regression/boundary vectors;
- the deterministic 100-case xorshift32 golden corpus;
- canonical PDA derivation/bump vectors;
- the 2,036-byte maximum AgreementVersion account allocation.

## Hard gate

Phase 3B cannot begin until the exact PR merge-candidate head passes both the TypeScript reference job and the read-only Rust parity job.

No token-transfer instruction is allowed in Phase 3A.

A green Phase 3A gate establishes implementation parity with the frozen reference specification only. It is not a smart-contract security audit, formal verification, legal approval, deployment approval, or mainnet readiness determination.

## PDA vector policy

PDA golden vectors use a fixed test program ID and fixed seed inputs. They validate seed namespace, ordering, fixed-width version encoding, and canonical bump derivation independently of whichever public program ID is later assigned to localnet/devnet.

## Program ID policy

The program ID currently present in `Anchor.toml` and `programs/royaltyrail/src/lib.rs` is a temporary compile-time development ID only. It has no deployment authority/keypair associated with it.

Before the first local-validator or devnet deployment:

1. generate the RoyaltyRail program keypair through the pinned Anchor toolchain;
2. run `anchor keys sync`;
3. commit only the public program ID configuration required by the project;
4. never commit deployment private keys;
5. freeze the devnet program ID once integration testing begins.
