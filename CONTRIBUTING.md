# Contributing to RoyaltyRails

RoyaltyRails is a devnet-only, unaudited settlement protocol. It is not mainnet-ready. Contributions are welcome within the limits below. Read [SECURITY.md](SECURITY.md) and [docs/SECURITY_V1.md](docs/SECURITY_V1.md) before you change anything that touches settlement.

## Toolchain

Everything is pinned. Do not upgrade any of it in an unrelated PR.

| Tool | Version | Source of truth |
| --- | --- | --- |
| Rust | 1.89.0 | `rust-toolchain.toml` |
| Anchor CLI / crates | 1.2.1 | `Anchor.toml`, `Cargo.toml` |
| Solana / Agave CLI | 4.1.2 | `Anchor.toml` |
| Node | 22 (CI), >= 20 | `package.json`, `.github/workflows/ci.yml` |
| Build container | `quay.io/ottersec/anchor:v1.2.1` | `.github/workflows/ci.yml`, `.devcontainer/devcontainer.json` |

## Build and test

These are the commands CI runs (see `.github/workflows/ci.yml`).

TypeScript reference specs and spec consistency:

```sh
npm ci
npm run check            # check:spec + tsc build + vitest
node scripts/phase3e/verify-identity.mjs
```

Rust parity:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --all-targets --locked
```

SBF program and IDL (inside the pinned Anchor container or the devcontainer):

```sh
anchor build --ignore-keys
node scripts/phase3e/verify-identity.mjs --idl target/idl/royaltyrail.json --so target/deploy/royaltyrail.so
```

The local-validator suites (`anchor test --script test|test-adversarial|test-devnet-rehearsal`) create disposable keys inside CI. Run them in CI, or in a throwaway container. Never run them on a machine that holds real keys.

## The frozen-artifact rule

The devnet deployment is pinned by `deployments/devnet/manifest.json`, which records the source commit and the SHA-256 of `royaltyrail.so` and `royaltyrail.json`.

- CI's `anchor-build` job rebuilds the program and runs `scripts/devnet/manifest.mjs verify-frozen`. That check fails if **any** build input differs from the manifest's source commit. Build inputs are `programs/`, `crates/`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, and `Anchor.toml`. It also fails if the rebuilt hashes differ.
- So any change to those paths, even a comment, makes the frozen manifest stale. Such a PR needs explicit owner approval and a planned redeploy with a regenerated manifest.
- `deployments/devnet/*` and `docs/evidence/*` are frozen records. Do not edit them in a PR.

## Out of scope for PRs

PRs that do any of these will be closed unless the owner approved them in advance:

- Changes to instruction logic, account layouts, PDA seeds, error codes, or events in `programs/` or `crates/royaltyrail-core/src/`.
- Edits to `deployments/devnet/*` or `docs/evidence/*`.
- Any keypair, seed phrase, RPC credential, or `.env` file. If you find key material in the repository, report it privately per [SECURITY.md](SECURITY.md); do not open an issue.
- Scripts or CI steps that send transactions, deploy, or upgrade against devnet or mainnet.
- Toolchain or dependency upgrades bundled with unrelated work.
- Mainnet configuration of any kind.
- Changes to the policy text of `SECURITY.md`. Its permalink is referenced by the planned on-chain security metadata.

## Pull requests

- Use the PR template and tick every box truthfully.
- Keep each PR to one concern.
- Green CI is not mainnet readiness (see [docs/SECURITY_V1.md](docs/SECURITY_V1.md) §33).
