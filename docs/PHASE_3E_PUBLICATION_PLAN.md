# Phase 3E — Keyless Preflight and Controlled Metadata Publication

**Status: preparation only. No on-chain transaction is authorized by this document.**

## Verified inputs

- Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Deployed program: `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB`.
- Upgrade authority: `CEhT8a7FrvN7uGCZRruMKp6uzAMusaFQ4XPDRo5i6wSg`.
- SBF SHA-256: `ee79ccb220e4e2c5071c9ec23a08a685e005bfed2aba6687ea784a044454505a` (609,376 bytes).
- Frozen Anchor IDL SHA-256: `07bbfcef23e27cac32cbee5aed4fcd1aeb0c1e837ef9febf28f0472b670449fa` (78,057 bytes).
- Source: `20ccae92e5f9ca6f18f5669fca0b6ea16cc0341e`.
- Artifact: GitHub Actions run `39092819552` / artifact ID `12123238615`, name `royaltyrail-sbf-20ccae92e5f9ca6f18f5669fca0b6ea16cc0341e`. The exact retrieved IDL, SBF and manifest hashes matched the frozen record; see [IDL provenance](evidence/phase-3e/idl-provenance.json).
- Security contact: `email:thagwapspot@gmail.com`. Actual email delivery is not independently verified.
- Draft security JSON: `deployments/devnet/security-metadata.json`, **689 UTF-8 bytes**, SHA-256 `1d5d8bb28d9da630a86763caafd142cf5916ca787b097db9272356fba8e849fb`. See [payload provenance](evidence/phase-3e/security-payload.json). This is not an on-chain publication hash.
- Policy URL: https://github.com/gwapupward-hub/RoyaltyRails/blob/07c7f90c648ae27a170b7961d54d1dbd58a9df6f/SECURITY.md (immutable commit permalink; works before PR merge).

## Canonical metadata accounts

Program Metadata Program: `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`. Canonical PDA seeds are [program public key, UTF-8 metadata seed zero-padded to 16 bytes] under the PMP program. The following were derived independently offline; `verify-pdas.mjs` also checks them with the pinned Solana JS client.

| Seed | Canonical PDA | Bump |
|---|---|---|
| `idl` | `6Au73HiMX852zhgyTuYNkYDQHZWiCb6rxZ4EsVyyc2p3` | 254 |
| `security` | `6yKDZVfqNwoDDBkSUBG2t2U6aApcNmqC8MtYGuPYDSxb` | 255 |

**Derived is not deployed:** PDA account existence and owner must be checked on fresh finalized RPC before publication.

## Owner/operator keyless checks

From a clean checkout of PR #10, without importing keypairs:

1. `node scripts/phase3e/verify-identity.mjs`
2. Download the **unmodified** build artifact from GitHub Actions run `39092819552`. Check exact byte count and hash; place the official `royaltyrail.json` under `target/devnet/royaltyrail.json` (never replace it with an unverified regenerated IDL).
3. `node scripts/phase3e/verify-identity.mjs --idl target/devnet/royaltyrail.json` (and optionally `--so <frozen-binary-path>`).
4. `npm ci --prefix tests/e2e --ignore-scripts`
5. `node scripts/phase3e/verify-pdas.mjs`
6. `node scripts/phase3e/devnet-preflight.mjs`. Read-only finalized RPC checks genesis, ProgramData authority, deployed binary, canonical PDA ownership, and existence.
7. For a complete independent replay, install root pinned dependencies and build the TypeScript reference, then run `RR_IDL_PATH=target/devnet/royaltyrail.json RR_REPORT_PATH=/tmp/royaltyrails-phase3e-verification.json node tests/e2e/devnet-verify.mjs`. This rechecks the 21 Phase 3D assertions.

Do not state that an RPC check passed until it actually ran. Do not commit or share private RPC API credentials in the output.

## Metadata CLI preflight — NOT AUTHORIZED TO WRITE

Official Program Metadata tooling documents the `write idl` and `write security` commands, which accept `--keypair` (canonical upgrade authority), `--payer` (fee/rent payer) and `--rpc`. The proposed CLI is `@solana-program/program-metadata@0.11.0`, subject to a full package/signer-path review and a **complete integrity-locked dependency installation before any signer use**. This release declares **Node >=24**, whereas RoyaltyRails' build CI uses Node 22; use an isolated CLI runtime, not an unreviewed toolchain upgrade.

- Frozen `royaltyrail.json` is **Anchor format**, not Codama. IDL Explorer supports PMP Anchor IDLs; native Solana Explorer may currently display only Codama. A conversion cannot silently replace the frozen IDL.
- `security-metadata.json` supplies protocol name, description, contact and immutable GitHub policy permalink. Do not invent a logo, auditors or external verified-build status.
- A 78,057-byte IDL can require multiple transactions or a buffer. Obtain the specific CLI-generated instruction plan, signer list, account rent and transaction fee estimate; do not invent a fee figure.
- Confirm that the target PMP program is deployed on devnet and that both metadata accounts are not unexpectedly occupied.
- Do not put the existing upgrade-authority key, seed or mnemonic into Claude/ChatGPT/GitHub/CI. The existing devnet-only cloud-custody exception does **not** authorize mainnet use.

## Mandatory explicit authorization gate

Before any chain write, show the owner a transaction-specific sheet: program and genesis, finalized slot, existing and expected metadata account owners/contents, payload hashes, CLI version and lockfile integrity, key roles (public addresses only), account rent and payer balance, exact expected instructions and postconditions, custody risk, and a declaration of **zero changes to the RoyaltyRails program binary or governance**.

**STOP until the owner explicitly authorizes publication of the exact metadata transactions.** No automatic merge, program upgrade, new custody action, or fee activation.

After approval, use the already approved signing environment for canonical metadata publication. Independently read back content from finalized RPC, record transaction signatures and content hashes under `docs/evidence/phase-3e/`, rerun the original 21-check devnet verifier, and report which explorers actually display the protocol name/IDL. Only then decide whether Phase 3E is PASS.
