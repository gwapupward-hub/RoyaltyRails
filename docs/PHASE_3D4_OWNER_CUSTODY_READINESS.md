# Phase 3D.4 Owner-Custodied Devnet Readiness

**Repository:** `gwapupward-hub/RoyaltyRails`
**Branch:** `feat/phase-3d-localnet-e2e-v1`
**Scope:** written as preparation; the custody model below is the recommendation. The program was later deployed and initialized on devnet; see *Actual custody* and `DEPLOYMENT_DEVNET_V1.md`.

## Custody decision

The strict custody requirement is incompatible with the existing Codespaces runbook for the three critical identities. A GitHub Codespace is GitHub infrastructure, so it must not hold the upgrade-authority, governance, or guardian private keys under this requirement. The existing `generate-keys.sh` remains an owner-only workflow, but it is not the recommended workflow for this stricter model because it writes key files in the environment where the repository is hosted.

The recommended model is:

1. Use an owner-controlled Mac/Linux computer, or an owner-controlled private VM, with Solana/Agave CLI 4.1.2 and Node 22 installed from independently verified sources.
2. Operate that machine from the iPhone using an SSH client such as Blink Shell or Termius over the owner's private network/VPN. The iPhone is the control surface; the private keys stay on the owner's machine and never enter Manus, Claude, GitHub, or CI.
3. Generate the three identities independently with `solana-keygen new --no-bip39-passphrase --word-count 12 --outfile ...`. Write each seed phrase on paper, clear the terminal, and verify each backup with `solana-keygen pubkey ASK`. Do not use `prompt://`; it derives a different address.
4. Publish only the five public addresses through `scripts/devnet/prepare-authorities.sh`. Do not publish key files, seed phrases, or shell transcripts.

The iPhone wallet-app route is **not** treated as deployment-compatible. Phantom and similar wallets may derive a different address from the same phrase and do not natively sign the Solana CLI's program-deployment buffer writes. They can be used only after a separately verified dApp transaction flow exists; that flow is not present here.

## Actual custody (owner-reported, 2026-10-18)

The five devnet private keys were generated and handled in an AI agent's environment, not on the owner-controlled machine recommended above and not in a Codespace. The owner recorded this as an approved devnet-only custody exception. The upgrade-authority, governance, and guardian backups were stored but not verified by re-entry. Consequence: treat all five keys as exposed to that environment's operator. Whoever can access them can upgrade this devnet program, and with it bypass every protection, and can act as its permanent governance. The recorded evidence proves the on-chain state at verification time, not that it remains under the owner's sole control. Never reuse these keys, or this custody model, beyond devnet.

## Five-role custody plan (recommended)

| Role | Public address published | Private key custody | Required operations |
|---|---|---|---|
| Program keypair | yes | owner-controlled machine only until first deployment | program address/program-account identity; `deploy.sh` |
| Deployer | yes | owner-controlled machine only | pays fees/rent, signs deployment as fee payer, creates the test mint, runs lifecycle |
| Upgrade authority | yes | owner-controlled machine plus paper backup | signs program deployment and the one-time `initialize_config` co-signature; highest-impact authority |
| Governance | yes | owner-controlled machine plus independent paper backup | signs the one-time `initialize_config`; permanent v1 governance, pause flags, guardian rotation |
| Guardian | yes | owner-controlled machine plus independent paper backup | emergency pause only; never required by deployment or initialization |

The three critical backups must be independent: do not derive them from one wallet seed, reuse a phrase, import them into Phantom, or store them in the same cloud-synced notes/photos system. The guardian key is intentionally absent from all deployment steps.

## Exact signing requirements verified from the implementation

- `deploy.sh` reads the program keypair, deployer, and upgrade-authority keypair. It verifies the devnet genesis hash, frozen manifest, artifact SHA-256 values, source commit, program identity, balance, non-existence of the program, on-chain upgrade authority, and byte-identical deployed bytes before writing public deployment evidence.
- `init-config.sh` reads the deployer, governance, and upgrade-authority keypairs. The client requires the governance signer and the current ProgramData upgrade authority signer; the guardian is passed as a public address and never signs. The program rejects mismatched ProgramData/program IDs and missing upgrade-authority signatures.
- `run-lifecycle.sh` reads only the deployer keypair and requires an already initialized, matching ProtocolConfig. It runs the lifecycle twice by default.
- No script uses or needs the guardian private key.

## Script changes prepared

1. `scripts/devnet/manifest.mjs` now rejects a frozen manifest unless it has all four non-program authorities, valid 32-byte base58 addresses, four distinct values, and a valid program ID. This prevents deployment automation from accepting a malformed or incomplete authority set.
2. `scripts/devnet/prepare-authorities.sh` accepts exactly five public addresses (program, deployer, upgrade authority, governance, guardian), validates them through the repository validator, writes only `deployments/devnet/authorities.json`, and synchronizes the public program ID into `declare_id!` and both Anchor program sections. It never reads or creates private keys.
3. Existing deployment gates remain active: `common.sh` pins the devnet genesis and frozen manifest, rejects CI/agent shells, requires the committed manifest, and checks each key against the manifest; `deploy.sh` refuses a redeploy and artifact/source/binary mismatch; `init-config.sh` and lifecycle scripts validate the expected authorities.

Example public-only preparation command, run by the owner after generating the three critical keys:

```bash
bash scripts/devnet/prepare-authorities.sh \
  PROGRAM_ADDRESS DEPLOYER_ADDRESS UPGRADE_AUTHORITY_ADDRESS \
  GOVERNANCE_ADDRESS GUARDIAN_ADDRESS
```

The placeholders must be replaced with the five public addresses. No private-key path belongs in this command.

## Gate 6 readiness

**Status: PASS for devnet by owner-accepted custody exception (2026-10-18).** Public identity commit `20ccae9`, frozen-manifest commit `97e3b76`, CI run `39092819552`, and post-freeze reproducibility CI run `39094215260` are recorded; all six required CI jobs passed; the frozen manifest SHA-256 is `8b1a287fc9a9e7823d33ca966465c73b63f64d92e14dcca5b5be7df7cb426b66`. On 2026-10-18 the owner accepted this devnet-only custody exception as meeting Gate 6 for devnet. The custody criteria themselves remain unmet: the keys were generated and handled in an AI agent's environment, and the upgrade-authority, governance, and guardian backups were stored but not verified by re-entry.

## Gate 7 readiness

**Status: PASS.** The owner approved Stage 4. The frozen artifact was deployed to devnet, finalized-chain verification confirmed the expected upgrade authority and byte-identical program, ProtocolConfig was initialized with governance plus upgrade-authority signatures, and the deployer-only 16-participant lifecycle passed twice. The independent keyless verifier passed 21/21 finalized-RPC checks. Public evidence is under `docs/evidence/`.

PR #9 was not merged. No mainnet operation was performed.

## Blockers and owner decisions

- **Signer environment:** choose and secure the owner-controlled Mac/Linux/private VM used over iPhone SSH (not followed by the recorded deployment; see *Actual custody*). Do not use GitHub Codespaces for the three critical private keys under the strict custody requirement.
- **Build supply chain:** verify the pinned Agave/Anchor/Rust toolchain on that owner-controlled machine. The repository's existing runbook pins the versions but does not itself make a third-party mobile wallet a compatible CLI signer.
- **Mainnet policy:** this devnet owner-held-key model is not a mainnet custody recommendation. Mainnet should use a hardened multisig/timelock or a separately verified external signer.
- **No PR merge:** PR #9 has not been merged. The devnet deployment and initialization were performed later (see `DEPLOYMENT_DEVNET_V1.md`).
