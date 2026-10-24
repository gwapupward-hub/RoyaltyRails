## What changed

<!-- One concern per PR. List files or areas touched. -->

## How it was verified

- [ ] `npm ci && npm run check` passes
- [ ] Rust (if touched): `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --all-targets --locked`
- [ ] Frozen manifest unchanged: `deployments/devnet/*` and `docs/evidence/*` are not modified, and if build inputs (`programs/`, `crates/`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `Anchor.toml`) changed, the owner approved it and the `anchor-build` result is explained below
- [ ] No key material: no keypairs, seed phrases, mnemonics, private keys, RPC credentials, or `.env` files
- [ ] No program change (instruction logic, account layouts, PDA seeds, error codes, events) without written owner approval, linked here
- [ ] Relative links in edited docs resolve

## Owner decision needed

<!-- "None", or what the owner must decide and the default taken. -->
