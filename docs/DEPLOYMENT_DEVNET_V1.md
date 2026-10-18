# RoyaltyRail Devnet Deployment V1

Status: **prepared, not deployed.** Stage 3D.4 is blocked on owner-controlled key generation and deployment. Every value in the evidence table below is pending; nothing here has been deployed to any cluster.

This document is the deployment runbook and, once completed, the deployment record. Devnet proof is a deployment and integration milestone. It is not a smart-contract security audit, and devnet is not mainnet.

## Deployment record

| Field | Value |
|---|---|
| Cluster | devnet (genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) |
| Program ID | pending — owner generates the program keypair (step 1) |
| Source commit | pending — the program-ID sync commit (step 2) |
| CI run that built the artifact | pending |
| Program binary SHA-256 | pending — from the CI artifact `SHA256SUMS` |
| IDL SHA-256 | pending — from the CI artifact `SHA256SUMS` |
| Deployment transaction | pending — `Signature:` printed by `solana program deploy` |
| Deploy slot / ProgramData | pending |
| Deployer public key | pending |
| Upgrade authority | pending |
| Governance / guardian | pending |
| ProtocolConfig / deployment ID | pending |
| Settlement test mint | pending (created by the first lifecycle run) |
| Devnet lifecycle evidence | pending — `docs/evidence/devnet-lifecycle-run-1.json` |
| Independent on-chain verification | pending |

## What is already proven before deployment

CI now has three local-validator lanes. On commit `32cca8896dbd574d9d1090af28286b59bbe4d4bf` ([run 39081713439](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39081713439)) all six jobs passed:

- **Anchor SBF + IDL** builds the program in the pinned `quay.io/ottersec/anchor:v1.2.1` container (Anchor 1.2.1, Agave/Solana CLI 4.1.2, Rust 1.89.0). It records the SHA-256 of `royaltyrail.so` and `royaltyrail.json` with the source commit and toolchain, and uploads them as the artifact `royaltyrail-sbf-<commit>`. That run still carried the temporary development ID, so its binary (`b1843bb7c018ea2102f40acc9962e780348849f10428b68938b6d9d1761ef37a`, 552,296 bytes) is **not** deployable. The deployable artifact is the one built from the program-ID sync commit.
- **Local validator devnet-lifecycle rehearsal** runs `tests/e2e/devnet-lifecycle.mjs`, the same script the owner runs on devnet, twice on one fresh validator. The first run initializes ProtocolConfig; the second reuses it and verifies it, as later devnet runs will.
- **Local validator positive lifecycle** and **Local validator adversarial matrix** (Stages 3D.2 and 3D.3) remain green.

### The devnet lifecycle script

`tests/e2e/devnet-lifecycle.mjs`:

- refuses mainnet-beta, testnet, and any non-local cluster other than devnet, by genesis hash;
- on devnet, requires the expected program ID, upgrade authority, governance, and guardian, and aborts on any mismatch;
- compares the deployed ProgramData bytes with the local artifact (any ProgramData tail beyond the ELF must be zero);
- initializes ProtocolConfig if it is absent, and aborts if an existing config was initialized by anyone other than the expected governance key;
- creates a six-decimal legacy SPL test mint on first use (deployer is mint authority, no freeze authority);
- runs the full lifecycle with the **maximum 16 participants** and uneven shares: Work and RevenuePool registration, proposal, 16 approvals of an independently computed agreement hash, activation, Royalty Inbox, direct funding (nonce 0), external deposit, `allocate_inbox`, 16 independent claims, payout-wallet rotation, a second direct funding (nonce 1), and claims that must reach only the rotated ATA;
- checks the agreement hash, every allocation (including rounding), and every allocation commitment against the compiled TypeScript reference implementation;
- after every step, checks the nonce and sequence behaviour, that each claim moved exactly its entitlement and touched no other participant, inbox solvency, and exact token conservation;
- has the deployer pay every fee and all rent. The 16 participants, funder, and rotated wallet are generated in memory, only sign, and are never written. The evidence file contains public keys, signatures, hashes, amounts, compute units, and transaction sizes only.

## Key roles

All keys are generated and held by the owner on an owner-controlled machine. No private key is ever pasted into chat, committed, placed in CI, or uploaded. Only public keys are shared.

| Key | Holder | Used for | On-chain power | Handling |
|---|---|---|---|---|
| Program keypair | owner | signing the initial deploy only | none after the first deploy; before it, whoever holds it can deploy to the address first | keep a backup until deployed |
| Deployer | owner (hot) | buffer rent, deploy fees, lifecycle fees and rent; test-mint authority; test Work origin | none over the program or config | low-value devnet hot key |
| Upgrade authority | owner (cold) | signing deploys and upgrades | can replace program bytecode, and therefore move any funds held by program vaults | offline when not deploying; a Ledger (`usb://ledger`) is a better signer |
| Governance | owner (cold) | initializing ProtocolConfig; governance pause flags; guardian rotation | **permanent:** v1 has no governance-rotation instruction | offline after initialization |
| Guardian | owner | emergency pause | pause only | separate from governance |

## Owner runbook

Prerequisites: Solana CLI **4.1.2** (`sh -c "$(curl -sSfL https://release.anza.xyz/v4.1.2/install)"`, then `solana --version` must print `solana-cli 4.1.2`), Node 22, and git. Keep every keypair outside the repository: it has no `.gitignore`.

### 1. Generate keys (owner)

```bash
umask 077
mkdir -p ~/royaltyrails-devnet && cd ~/royaltyrails-devnet
solana-keygen new --outfile program-keypair.json
solana-keygen new --outfile deployer.json
solana-keygen new --outfile upgrade-authority.json
solana-keygen new --outfile governance.json
solana-keygen new --outfile guardian.json
for k in program-keypair deployer upgrade-authority governance guardian; do
  printf '%-18s %s\n' "$k" "$(solana-keygen pubkey "$k.json")"
done
```

Record each seed phrase offline, at least for `upgrade-authority` and `governance`. Send **only the five public keys** printed by the loop.

### 2. Program-ID sync (Claude, after receiving the public keys)

The program ID is committed as `declare_id!` in `programs/royaltyrail/src/lib.rs` and as `[programs.localnet]` / `[programs.devnet]` in `Anchor.toml`. CI then builds the deployable artifact `royaltyrail-sbf-<sync commit>`, and its SHA-256 values are recorded in the table above. CI's localnet lanes re-sync to throwaway keypairs, so they are unaffected.

### 3. Fetch and verify the artifact (owner)

```bash
git clone https://github.com/gwapupward-hub/RoyaltyRails.git && cd RoyaltyRails
git checkout <SYNC_COMMIT>
# Download artifact royaltyrail-sbf-<SYNC_COMMIT> from the CI run's Artifacts section, or:
gh run download <RUN_ID> -n royaltyrail-sbf-<SYNC_COMMIT> -D artifact
(cd artifact && sha256sum -c SHA256SUMS && cat SOURCE_COMMIT BUILD_INFO)   # macOS: shasum -a 256 -c SHA256SUMS
grep -F '<PROGRAM_ID>' artifact/BUILD_INFO      # declare_id must be the new program ID
mkdir -p target/deploy target/idl
cp artifact/royaltyrail.so target/deploy/ && cp artifact/royaltyrail.json target/idl/
```

The checksums and program ID must match this document before you continue.

### 4. Fund the deployer (owner)

Deployment holds about 2.8 SOL of ProgramData rent permanently, plus about 2.8 SOL of buffer rent that is refunded when the deploy finishes. Each lifecycle run costs about 0.06 SOL. Fund the deployer with **6 devnet SOL** from https://faucet.solana.com or `solana airdrop`:

```bash
solana config set --url devnet
solana balance ~/royaltyrails-devnet/deployer.json
```

### 5. Deploy (owner)

```bash
solana program deploy target/deploy/royaltyrail.so \
  --url devnet \
  --program-id ~/royaltyrails-devnet/program-keypair.json \
  --upgrade-authority ~/royaltyrails-devnet/upgrade-authority.json \
  --keypair ~/royaltyrails-devnet/deployer.json \
  --fee-payer ~/royaltyrails-devnet/deployer.json
```

Keep the printed `Program Id:` and `Signature:` lines. If the deploy is interrupted, recover the buffer rent with `solana program show --buffers --keypair ~/royaltyrails-devnet/deployer.json --url devnet` and `solana program close --buffers --keypair ~/royaltyrails-devnet/deployer.json --url devnet`.

### 6. Verify the deployed bytes (owner)

```bash
solana program show <PROGRAM_ID> --url devnet      # Authority must be the upgrade-authority public key
solana program dump <PROGRAM_ID> deployed.so --url devnet
head -c "$(wc -c < target/deploy/royaltyrail.so)" deployed.so | sha256sum   # must equal the artifact SHA-256
```

### 7. Run the devnet lifecycle immediately (owner)

`initialize_config` is first-caller-wins (see risk 4), so run this straight after step 6. The first run creates the test mint and initializes ProtocolConfig.

```bash
npm ci
npm install --no-save --package-lock=false @anchor-lang/core@1.2.1 @solana/web3.js@1.99.0 @solana/spl-token@0.4.15
npm run build
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET="$HOME/royaltyrails-devnet/deployer.json" \
RR_EXPECTED_PROGRAM_ID=<PROGRAM_ID> \
RR_EXPECTED_UPGRADE_AUTHORITY=<UPGRADE_AUTHORITY_PUBKEY> \
RR_EXPECTED_GOVERNANCE=<GOVERNANCE_PUBKEY> \
RR_EXPECTED_GUARDIAN=<GUARDIAN_PUBKEY> \
RR_GOVERNANCE_KEYPAIR="$HOME/royaltyrails-devnet/governance.json" \
RR_EVIDENCE_PATH=docs/evidence/devnet-lifecycle-run-1.json \
node tests/e2e/devnet-lifecycle.mjs
```

The script prints `status: PASS` and writes the evidence file. If it reports that ProtocolConfig governance is not the expected key, someone initialized the deployment first: stop, and redeploy under a new program keypair.

### 8. Secure the keys (owner)

Move `governance.json` and `upgrade-authority.json` offline. The governance key cannot be replaced in v1. `deployer.json` may stay on the machine as a low-value devnet key.

### 9. Hand back (owner)

Provide the `Signature:` line from step 5 and `docs/evidence/devnet-lifecycle-run-1.json`, either committed to the PR branch or pasted; it contains no secrets. Claude then independently re-verifies against devnet RPC: program owner, upgrade authority, ProgramData bytes against the artifact, ProtocolConfig fields, every evidence transaction, and the final agreement and token state. It then completes this document and re-runs CI on the final commit.

## Measured 16-participant behaviour

From the CI rehearsal on commit `32cca88` (Agave 4.1.2 local validator, pinned build). Two runs with different random keys:

| Instruction | Compute units (run 1 / run 2) | Default limit |
|---|---|---|
| `fund_and_allocate` | 150,311 / 138,311 | 200,000 |
| `allocate_inbox` | 145,638 / 133,638 | 200,000 |
| `propose_agreement` (16 participants) | 116,490 / 116,490 | 200,000 |
| `claim_participant` | up to 52,863 / 33,363 | 200,000 |
| `initialize_royalty_inbox` | 48,791 / 36,791 | 200,000 |

The largest transaction is 927 of 1,232 bytes (the 16-participant proposal). Compute varies by roughly 12,000–20,000 units between runs because canonical PDA and ATA validation runs `find_program_address`, whose bump search length depends on the keys. The devnet run records its own figures.

## Unresolved risks

1. **Token freeze authority (untested).** The devnet test mint has no freeze authority; real USDC does. A freeze of the Royalty Inbox makes direct funding and claims fail; a freeze of a payout ATA makes that participant's claims fail. This is a liveness dependency on the mint issuer, not a theft or solvency vector. It is not exercised on-chain, and integrators must disclose it.
2. **Deposits to non-settleable agreements are locked.** Tokens sent to the canonical inbox of an agreement that is Proposed and then cancelled or rejected can never be allocated or claimed, and v1 has no admin withdrawal by design (Stage 3D.3 locked 250,000 test units this way). Integrations must deposit only to Active or Superseded agreements' inboxes. Deposits to a Proposed agreement that later activates become allocatable, but this path has not been exercised on-chain.
3. **Maximum participants (measured, moderate headroom).** At 16 participants, allocation instructions used up to 150,311 compute units against the 200,000 default, about 25% headroom, and usage varies with keys. Composing these instructions with others in one transaction, or future code growth, can exceed the default. Production clients should request an explicit compute budget, and benchmarks should be repeated for every program change. The devnet run must confirm the figures on devnet's runtime.
4. **Configuration front-running.** `initialize_config` is permissionless and first-caller-wins: whoever initializes first becomes permanent governance and fixes the settlement mint. On devnet this is handled operationally (initialize immediately after deploy, and the lifecycle script aborts on a mismatch). Before mainnet, initialization should be bound to the upgrade authority or performed atomically with deployment. That is a program change, outside Stage 3D.4.
5. **Upgrade authority is a superuser.** A single key can replace the bytecode and with it every protection, including "no admin withdrawal". Devnet uses one cold key; mainnet requires a hardened multisig with a timelock and monitoring (`SECURITY_V1.md` §23).
6. **Governance is permanent.** v1 cannot rotate governance. Losing the governance key permanently removes unpause and guardian rotation for that deployment; the guardian can still pause.
7. **Build verification.** The deployable artifact is built by CI in a pinned container and its hash is recorded, and the deployed bytes are compared with it. It is not a `solana-verify` verifiable build, and independent rebuild reproducibility outside that container has not been demonstrated.
8. **Devnet is not durable.** Devnet can be reset. The recorded signatures and this document remain the evidence of record.
