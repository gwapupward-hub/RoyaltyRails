# RoyaltyRail Devnet Deployment V1

Status: **prepared, not deployed.** Stage 3D.4 is blocked on owner-controlled key generation and deployment. Every value in the deployment record below is pending; nothing here has been deployed to any cluster.

This document is the deployment runbook and, once completed, the deployment record. The runbook assumes the owner works only from an iPhone, using GitHub Codespaces in Safari. Devnet proof is a deployment and integration milestone. It is not a smart-contract security audit, and devnet is not mainnet.

## Deployment record

| Field | Value |
|---|---|
| Cluster | devnet (genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) |
| Program ID | pending — owner generates the program keypair (step 3) |
| Source commit | pending — the program-ID sync commit (step 4) |
| CI run that built the artifact | pending |
| Program binary SHA-256 | pending — from the CI artifact `SHA256SUMS` |
| IDL SHA-256 | pending — from the CI artifact `SHA256SUMS` |
| Deployment transaction | pending — `docs/evidence/devnet-deployment.json` |
| Deploy slot / ProgramData | pending |
| Deployer public key | pending |
| Upgrade authority | pending |
| Governance / guardian | pending |
| ProtocolConfig / deployment ID | pending |
| Settlement test mint | pending (created by the first lifecycle run) |
| Devnet lifecycle evidence | pending — `docs/evidence/devnet-lifecycle-*.json` |
| Independent on-chain verification | pending |

## Configuration initialization is bound to the upgrade authority

`initialize_config` used to be first-caller-wins. Anyone who called it after deployment and before the owner became the permanent governance (v1 has no governance rotation), with a settlement mint of their choosing.

It now requires the program's **current upgrade authority** as a co-signer. The program checks this against the program's own ProgramData account: `Program<Royaltyrail>` pins the program ID, and the ProgramData address must be that program's. Governance also co-signs and pays the config rent, so the governance and upgrade-authority keys stay separate.

Immutable programs (no authority) and the all-zero key are never accepted, so an immutable program must initialize its config before it is finalized. Anchor creates `init` accounts before evaluating the authorization constraints, but a failed check aborts the transaction atomically: no config account or governance state persists.

The adversarial matrix lands each of the following attacks on-chain **before** the authorized initialization. Each is rejected with its exact error, and every tracked account, including the never-created config, is byte-identical afterwards:

| ID | Attack | Rejected by |
|---|---|---|
| CFG-04 | attacker signs as both governance and upgrade authority | `UnauthorizedConfigInitializer` on `program_data` |
| CFG-05 | attacker substitutes the ProgramData of a real upgradeable program it deployed and controls | `InvalidProgramData` on `program` |
| CFG-06 | attacker substitutes its own program account and ProgramData | `InvalidProgramId` on `program` |
| CFG-07 | attacker passes a non-loader account as ProgramData | `AccountOwnedByWrongProgram` on `program_data` |
| CFG-08 | attacker names the real upgrade authority without its signature | `AccountNotSigner` on `upgrade_authority` |

The authorized initializer then succeeds and holds governance (`INIT-AUTH-01`). The predicate `is_config_initializer` is also unit-tested for a matching key, a mismatched key, an immutable program, and the all-zero key. This change adds about 57 KB to the program binary, which costs about 0.29 extra SOL of rent on devnet.

## What is already proven before deployment

On commit `24bb48872849294dba4c15c8e1554b8b90124899`, [CI run 39084154985](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39084154985) passed all six jobs: TypeScript reference specs, Rust parity, Anchor SBF + IDL, Local validator positive lifecycle, Local validator adversarial matrix (68 rejections), and Local validator devnet-lifecycle rehearsal.

- **Anchor SBF + IDL** builds in the pinned `quay.io/ottersec/anchor:v1.2.1` container (Anchor 1.2.1, Agave/Solana CLI 4.1.2, Rust 1.89.0). It records the SHA-256 of `royaltyrail.so` and `royaltyrail.json` with the built commit and toolchain, and uploads them as the artifact `royaltyrail-sbf-<built commit>`. That build (`b9b7858c21329164fe9d893f7d8831eb61c47a1275d1ba624a13b318d358a5e1`, 609,376 bytes; IDL `d274ad7d71def695996ac042359e5eafcb06d070b08309e36c895865d1ea9432`) still carries the temporary development ID, so it is **not** deployable.
- **Local validator devnet-lifecycle rehearsal** runs `tests/e2e/devnet-lifecycle.mjs` twice on one fresh validator, with governance separate from the upgrade authority and initially unfunded, as on devnet. The first run tops up governance with exactly the config rent and initializes ProtocolConfig with both signatures; the second run verifies and reuses it.
- **The full owner path was rehearsed end to end** on a local validator with throwaway keys (since deleted):
  - `codespace-setup.sh` installed the pinned CLI;
  - `generate-keys.sh` refused an in-repository path and an overwrite;
  - an artifact was built for the generated program ID;
  - `deploy.sh` verified checksums, program ID, and sources, deployed with a separate upgrade authority, and verified the on-chain authority and deployed bytes;
  - `run-lifecycle.sh` initialized ProtocolConfig with the cold governance key and completed the 16-participant lifecycle twice.

### The devnet lifecycle script

`tests/e2e/devnet-lifecycle.mjs`:

- refuses mainnet-beta, testnet, and any non-local cluster other than devnet, by genesis hash;
- on devnet, requires the expected program ID, upgrade authority, governance, and guardian, and aborts on any mismatch;
- compares the deployed ProgramData bytes with the local artifact;
- initializes ProtocolConfig with the governance and upgrade-authority signatures if it is absent, and otherwise verifies the stored governance, guardian, and token program;
- creates a six-decimal legacy SPL test mint on first use (deployer is mint authority, no freeze authority);
- runs the full lifecycle with the **maximum 16 participants** and uneven shares:
  - Work and RevenuePool registration;
  - proposal and 16 approvals of an independently computed agreement hash;
  - activation and the Royalty Inbox;
  - direct funding (nonce 0), an external deposit, and `allocate_inbox`;
  - 16 independent claims;
  - payout-wallet rotation, a second direct funding (nonce 1), and claims that must reach only the rotated ATA;
- checks the agreement hash, every allocation, and every allocation commitment against the compiled TypeScript reference;
- after every step, checks nonce and sequence behaviour, claim isolation, inbox solvency, and exact token conservation;
- has the deployer pay every fee and all rent except the config rent, which governance pays after the top-up. The 16 participants, funder, and rotated wallet are generated in memory, only sign, and are never written. The evidence file contains only public data.

## Key roles

| Key | Used for | On-chain power | Sensitivity |
|---|---|---|---|
| Program keypair | signing the initial deploy only | none after the first deploy; before it, whoever holds it can deploy to the address first | until deployed |
| Deployer | deploy rent and fees, lifecycle fees and rent, test-mint authority, test Work origin | none over the program or config | low (hot) |
| Upgrade authority | deploys, upgrades, and the one-time config initialization | replaces program bytecode, and therefore controls all program-held funds; approves config initialization | highest |
| Governance | config initialization; governance pause flags; guardian rotation | **permanent:** v1 has no governance-rotation instruction | high |
| Guardian | emergency pause | pause only | medium |

## iPhone runbook (GitHub Codespaces, devnet only)

Everything below runs in a GitHub Codespace opened in Safari. No local computer is needed. Claude never receives, sees, or needs any private key or seed phrase; only public keys and public evidence files are shared.

### 0. Before you start

- Protect the GitHub account with two-factor authentication (preferably a passkey). Anyone who can sign in to your GitHub account can open this Codespace and read its keys.
- In GitHub **Settings → Codespaces**, turn off Settings Sync for this work and set a short **default retention period** for stopped codespaces.
- Do not install extensions in this Codespace.
- These keys are **devnet only**: never send them mainnet funds and never reuse them for mainnet.

### 1. Open a Codespace on the PR branch

In Safari, open https://github.com/codespaces/new, pick repository `gwapupward-hub/RoyaltyRails`, branch `feat/phase-3d-localnet-e2e-v1`, and a 2-core machine, then tap **Create codespace**. If GitHub shows the mobile layout without Codespaces controls, use Safari's **aA → Request Desktop Website**.

When the editor loads, open a terminal: **☰ menu → Terminal → New Terminal**. Long-press the terminal to paste.

### 2. Install the pinned toolchain

```bash
bash scripts/devnet/codespace-setup.sh
source ~/.bashrc
```

This installs Solana CLI 4.1.2, installs Node dependencies with install scripts disabled, builds the TypeScript reference, and points the CLI at devnet.

### 3. Generate the devnet keys and back them up

```bash
bash scripts/devnet/generate-keys.sh
```

The script writes five keys to `~/royaltyrails-devnet/`, outside the repository, with owner-only permissions. It refuses to overwrite existing keys. Each key's 12-word seed phrase is printed once. Write the **upgrade-authority**, **governance**, and **guardian** phrases on paper (see *Backups* below), then run `clear`.

**Send Claude only the five public keys** printed at the end.

### 4. Program-ID sync (Claude)

Claude commits the program ID as `declare_id!` and in `Anchor.toml`. CI then builds the deployable artifact `royaltyrail-sbf-<commit>`, and Claude records its SHA-256 here and replies with the commit and the CI run ID. CI's localnet lanes re-sync to throwaway keys and are unaffected.

### 5. Fetch the deployable artifact

```bash
git pull
gh run download <RUN_ID> -n royaltyrail-sbf-<COMMIT> -D artifact
cat artifact/SOURCE_COMMIT artifact/BUILD_INFO artifact/SHA256SUMS
```

If `gh` reports a permissions error, run `gh auth login --web` and finish the device login in Safari. The checksums must match the values Claude records in this document.

### 6. Fund the deployer with devnet SOL

```bash
solana address -k ~/royaltyrails-devnet/deployer.json
```

Request devnet SOL for that address at https://faucet.solana.com (sign in with GitHub in Safari), or with `solana airdrop 2 <address>`, which is rate-limited. Deployment permanently holds about **3.10 SOL** of program rent, and needs about 3.10 SOL more for the temporary buffer, refunded when the deploy completes. Each lifecycle run costs about 0.06 SOL. **Fund about 7 SOL.** `deploy.sh` checks the exact minimum before deploying.

### 7. Deploy

```bash
bash scripts/devnet/deploy.sh artifact
```

The script:

- refuses any cluster but devnet;
- verifies the artifact checksums, that it was built for your program ID, and that the program sources are unchanged since the artifact's commit;
- checks the deployer balance and refuses if the program is already deployed;
- deploys with the separate upgrade-authority key;
- verifies the on-chain upgrade authority and that the deployed bytes equal the artifact;
- writes the public record `docs/evidence/devnet-deployment.json`.

### 8. Run the devnet lifecycle

```bash
bash scripts/devnet/run-lifecycle.sh
```

The first run initializes ProtocolConfig, co-signed by the upgrade authority and governance, then runs the 16-participant lifecycle. It prints `status: PASS` and writes `docs/evidence/devnet-lifecycle-<time>.json`. A second run should also pass, reusing the config.

### 9. Hand back the public evidence

```bash
git add docs/evidence/
git commit -m "docs: add devnet deployment and lifecycle evidence"
git push
```

`git add docs/evidence/` adds only the public evidence files; the keys live outside the repository. Claude then independently verifies everything against devnet RPC, completes this document, and re-runs CI:

- program owner, upgrade authority, and ProgramData bytes against the artifact;
- ProtocolConfig fields;
- every evidence transaction;
- the final agreement and token state.

### 10. After verification

Once Claude confirms the deployment, either delete the key files (`rm -r ~/royaltyrails-devnet`) or delete the whole Codespace. Keep the paper seed phrases: they are the only remaining copy of the upgrade-authority and governance keys.

## Custody risks of cloud-generated keys

Generating keys in a Codespace is acceptable **for devnet only**. The risks:

- **Plaintext keys on GitHub-hosted infrastructure.** Solana keypair files are unencrypted JSON on a VM run by GitHub. Anyone with access to your GitHub account, or an active browser session on an unlocked phone, can open the Codespace and read them.
- **Code running beside the keys can read them.** That includes npm dependencies at runtime and anything installed into the Codespace. The setup disables install scripts and pins the E2E client versions, but `run-lifecycle.sh` still executes dependency code with access to the keys.
- **Retention.** Keys persist across stops until the Codespace is deleted (or the retention period expires). After deletion only your seed-phrase backups remain.
- **Seed phrase exposure on iPhone.** Screenshots sync to iCloud Photos, and copying text can reach other Apple devices through Universal Clipboard. Typing phrases into Notes or chat leaves copies.
- **Single-factor upgrade authority.** On devnet one key controls upgrades. That is acceptable for devnet but **not for mainnet**, where the upgrade authority must be a hardened multisig with a timelock (`SECURITY_V1.md` §23). An iPhone-only owner will need a mobile-compatible multisig or a hardware wallet with a supported signer before any mainnet deployment. Mainnet keys must never be generated in a Codespace.

### Backups

- Write each upgrade-authority, governance, and guardian seed phrase on paper and store it somewhere private. Do not photograph it.
- A password-manager secure note (for example, Apple Passwords or 1Password) is an acceptable devnet-only alternative if you accept the cloud-sync risk.
- To restore a key later: `solana-keygen recover --outfile ~/royaltyrails-devnet/<name>.json`, enter the 12 words, and press Enter at the passphrase prompt (keys were created without one). Then confirm `solana-keygen pubkey` matches the recorded public key.

## Who does what

| Action | Owner (iPhone) | Claude |
|---|---|---|
| Create, stop, and delete the Codespace | ✓ | |
| Run setup and key generation; write down seed phrases | ✓ | |
| Share the five public keys | ✓ | |
| Commit the program-ID sync; record artifact hashes; confirm CI | | ✓ |
| Obtain devnet SOL from the faucet | ✓ | |
| Download the artifact, deploy, run the lifecycle | ✓ | |
| Commit and push the public evidence files | ✓ | |
| Independently verify the deployment on devnet; complete this record | | ✓ |
| Delete the keys or Codespace after verification; keep paper backups | ✓ | |
| Review and merge PR #9 | ✓ | |

## Measured 16-participant behaviour

From the CI rehearsal of commit `24bb488` (Agave 4.1.2 local validator, pinned build), two runs with different random keys:

| Instruction | Compute units (run 1 / run 2) | Default limit |
|---|---|---|
| `fund_and_allocate` | 148,811 / 144,330 | 200,000 |
| `allocate_inbox` | 144,138 / 139,638 | 200,000 |
| `propose_agreement` (16 participants) | 117,990 / 119,490 | 200,000 |
| `claim_participant` | 43,863 / 39,382 | 200,000 |
| `initialize_royalty_inbox` | 44,291 / 48,791 | 200,000 |
| `initialize_config` (upgrade-authority co-signed) | 12,826 (run 1 only) | 200,000 |

The largest transaction is 927 of 1,232 bytes (the 16-participant proposal).

Compute varies between runs because canonical PDA and ATA validation runs `find_program_address`, whose bump-search length depends on the keys. The devnet run records its own figures.

## Unresolved risks

1. **Token freeze authority (untested).** The devnet test mint has no freeze authority; real USDC does. A freeze of the Royalty Inbox makes direct funding and claims fail; a freeze of a payout ATA makes that participant's claims fail. This is a liveness dependency on the mint issuer, not a theft or solvency vector. It is not exercised on-chain, and integrators must disclose it.
2. **Deposits to non-settleable agreements are locked.** Tokens sent to the canonical inbox of an agreement that is Proposed and then cancelled or rejected can never be allocated or claimed, and v1 has no admin withdrawal by design (Stage 3D.3 locked 250,000 test units this way). Integrations must deposit only to Active or Superseded agreements' inboxes. Deposits to a Proposed agreement that later activates have not been exercised on-chain.
3. **Maximum participants (measured, moderate headroom).** At 16 participants, allocation instructions use most of the 200,000 default compute budget (see the table above), and usage varies with keys. Composing these instructions with others in one transaction, or future code growth, can exceed the default. Production clients should request an explicit compute budget, and benchmarks should be repeated for every program change. The devnet run must confirm the figures on devnet's runtime.
4. **Upgrade authority is a superuser.** One key can replace the bytecode and with it every protection, including "no admin withdrawal", and it now also approves the one-time config initialization. Devnet uses one cloud-generated key; mainnet requires a hardened multisig with a timelock and monitoring.
5. **Governance is permanent.** v1 cannot rotate governance. Losing the governance key permanently removes unpause and guardian rotation for that deployment; the guardian can still pause.
6. **Cloud key custody.** Devnet keys are generated and held in a GitHub Codespace (see *Custody risks*). This is acceptable only because devnet value is nil.
7. **Build verification.** The deployable artifact is built by CI in a pinned container, its hash is recorded, and the deployed bytes are compared with it. Identical source has produced byte-identical builds in separate CI runs. It is not a `solana-verify` verifiable build, and reproducibility outside that container has not been demonstrated.
8. **Devnet is not durable.** Devnet can be reset. The recorded signatures and this document remain the evidence of record.

Resolved in Stage 3D.4: **first-caller configuration initialization** (see above).
