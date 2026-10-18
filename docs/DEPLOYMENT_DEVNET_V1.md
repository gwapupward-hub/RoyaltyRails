# RoyaltyRail Devnet Deployment V1

Status: **devnet deployed and independently verified.** Phase 3D hard gates 6 (permanent devnet identity) and 7 (devnet deployment evidence) are complete for this devnet deployment. No mainnet operation was performed. The five private keys remain outside the repository and CI.

This document is the deployment runbook and, once completed, the deployment record. Devnet proof is a deployment and integration milestone. It is not a smart-contract security audit, and devnet is not mainnet.

**Owner custody decision (commit `20ccae9`, [`PHASE_3D4_OWNER_CUSTODY_READINESS.md`](PHASE_3D4_OWNER_CUSTODY_READINESS.md)):** the keys are held on an owner-controlled machine operated from the iPhone over SSH, not in a GitHub Codespace. The public addresses were recorded with `scripts/devnet/prepare-authorities.sh`, which handles public data only.

The runbook below still applies from step 5 onward, run on that machine instead of a Codespace. The owner scripts are tested on Linux x86_64. On macOS, `sha256sum` must be available (for example from Homebrew `coreutils`), or use a Linux VM.

| Gate | Status | Blocked on |
|---|---|---|
| 6. Permanent devnet identity frozen securely | PASS | frozen public identity commit `20ccae9`; manifest commit `97e3b76`; six CI jobs green |
| 7. Devnet deployment and end-to-end smoke evidence | PASS | finalized deployment, initialization, two lifecycle runs, and 21/21 independent checks |

## Deployment record

| Field | Value |
|---|---|
| Cluster | devnet (genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) |
| Program ID | `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB` (no devnet account before deployment: checked at finalized commitment) |
| Frozen manifest | [`deployments/devnet/manifest.json`](../deployments/devnet/manifest.json), byte-identical to the CI `MANIFEST.json`, SHA-256 `8b1a287fc9a9e7823d33ca966465c73b63f64d92e14dcca5b5be7df7cb426b66` |
| Source commit / CI run that built the artifact | `20ccae92e5f9ca6f18f5669fca0b6ea16cc0341e` / [run 39092819552](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39092819552) (all six jobs green), artifact `royaltyrail-sbf-20ccae92e5f9ca6f18f5669fca0b6ea16cc0341e` |
| Program binary / IDL SHA-256 | `ee79ccb220e4e2c5071c9ec23a08a685e005bfed2aba6687ea784a044454505a` (609,376 bytes) / `07bbfcef23e27cac32cbee5aed4fcd1aeb0c1e837ef9febf28f0472b670449fa` (78,057 bytes) |
| Reproduced by later CI builds | yes: byte-identical hashes from independent CI builds of `97e3b76` ([run 39094215260](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39094215260)) and `3e704c6` ([run 39094398777](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39094398777)); all six jobs green on both |
| Deployment transaction, slot, ProgramData | `docs/evidence/devnet-deployment.json`; signature `4B3m2MAozfJAxEaLXvzszvKBYqpynFs5K2fKFjUyFQXgkjx661uh4aHcnEmm7PNRLos6ZkQZAAZM3YY5LZPZYvxC`, slot `512336328`, ProgramData `2YGn5tQGmfQWfSGnFzxeKNxVaLzD43LJhme8jXqRcPZF` |
| Deployer / upgrade authority | `Gpub3uSCyGZDpHGMeRmnw3a7cf1X2usW41ioLDaSgQMa` / `CEhT8a7FrvN7uGCZRruMKp6uzAMusaFQ4XPDRo5i6wSg` |
| Governance / guardian | `9bJDtawHuNnJh1fUYNuxnvjDihWgEHuJovuFcT1nDJ9m` (permanent) / `9Kfq3bPSNy71PKUqQMRaQ82BEv8BFUbN15J54HQzujPp` |
| ProtocolConfig, deployment ID, settlement test mint | `docs/evidence/devnet-config.json`; config `2mjq5rPDHCamoqFkDmh277Y44pf8nKfUyw9byJPK1Qtq`; mint `GcvqpGThY4ay9Ro7tfWwdSmKWYw8ZruZyvEwSdbnLUtZ` |
| Lifecycle runs (16 participants, twice) | `docs/evidence/devnet-lifecycle-20261018T055623Z-run1.json` and `-run2.json`; both PASS |
| Independent verification | `docs/evidence/devnet-verification.json`; 21/21 checks PASS at finalized commitment |

## Signing model

Claude and GitHub Actions never hold, receive, or see a private key or seed phrase. Every private key is generated and used only in the owner's own terminal, on the owner-controlled machine chosen in the custody decision above. Each owner script reads only the keys its step needs:

| Step (who runs it) | Program key | Deployer | Upgrade authority | Governance | Guardian |
|---|---|---|---|---|---|
| `generate-keys.sh` (owner) | creates | creates | creates, backup verified | creates, backup verified | creates, backup verified |
| CI build, ID check, manifest (GitHub) | public key | public key | public key | public key | public key |
| `deploy.sh` (owner, types `DEPLOY …`) | signs program creation | pays, signs | signs deploy and buffer writes | | |
| `init-config.sh` (owner, types `INITIALIZE …`) | | pays | co-signs `initialize_config` | signs `initialize_config`, pays config rent | |
| `run-lifecycle.sh` (owner) | | pays, test-mint authority | | | |
| `devnet-verify.mjs` (Claude) | | | | | |

The guardian's private key is not used by any deployment step; on-chain it can only pause. The program key has no power once the program is deployed.

All of this was rehearsed with the guardian key absent throughout and the governance key present only during initialization. The two lifecycle runs had only the deployer key present.

### On-chain powers and backups

| Key | On-chain power | Backup |
|---|---|---|
| Program keypair | none after the first deploy; before it, whoever holds it can deploy to the address first | none (if lost before deployment, generate a new identity) |
| Deployer | none over the program or config; settlement test-mint authority | none (loss ends test-token minting for this deployment only) |
| Upgrade authority | replaces program bytecode and therefore controls all program-held funds; approves the one-time config initialization | paper, verified |
| Governance | **permanent** (v1 has no governance rotation): pause flags, guardian rotation | paper, verified |
| Guardian | emergency pause only | paper, verified |

## Threat model: key exposure

| Vector | Mitigation | Residual risk |
|---|---|---|
| AI-agent runtime (Claude Code containers) | Keys are generated and used only in the owner's Codespace. `generate-keys.sh` refuses to run if `CLAUDECODE` is set. On devnet, `common.sh` refuses agent shells for every key-using step. Claude only ever receives public keys and public evidence. | The guards prevent accidents; they are not a security boundary. The owner must not run Claude Code (or any agent) inside the key-holding Codespace. |
| GitHub Actions / CI logs / artifacts | CI never receives keys. It builds and checks only public data: the program ID, public keys, hashes. Every key-using script refuses to run when `CI` or `GITHUB_ACTIONS` is set. | none identified |
| Source control | Keys live in `~/royaltyrails-devnet` with mode 700/600. Every script refuses key directories inside the repository. The owner commits only named public files. `.gitignore` excludes build output. | none, provided only the runbook's explicit `git add` paths are used |
| Terminal scrollback and logs | Seed phrases appear only on the terminal's alternate screen, which has no scrollback, and are cleared before returning. They are never written to disk or logs. Backup verification input is hidden. Deploy output is shown and captured in memory, never written to a file (a failed deploy prints the temporary buffer's recovery phrase). | Anything visible on screen can be photographed or screen-recorded. |
| Shell history | No secret is ever typed on a command line. Phrases are entered only at hidden prompts. | none identified |
| Codespace / GitHub infrastructure | Plaintext keyfiles are on a GitHub-hosted VM. Mitigations: two-factor or passkey on the GitHub account; Settings Sync off; no extensions; never open key files in the editor; short retention; delete the Codespace after verification. | GitHub, and anyone who controls the owner's GitHub session, can read the keys. Acceptable **for devnet only**. |
| npm dependencies | Root and E2E lockfiles pin all packages by version and SHA-512 integrity. All 81 E2E packages resolve from registry.npmjs.org. Installs run with `--ignore-scripts`. Critical keys are loaded only in the one step that signs with them (`init-config.sh`), and lifecycle runs read only the deployer. | Locked dependency code still runs beside the deployer and, during initialization, the governance and upgrade-authority keys. |
| Solana CLI supply chain | `codespace-setup.sh` no longer pipes an installer into `sh`. It downloads the Agave v4.1.2 release archive and verifies its pinned SHA-256 (`5991d027…f770`) before extracting `solana` and `solana-keygen`. That hash was confirmed identical from GitHub Releases and release.anza.xyz, and the archive's binaries are byte-identical to those used in every local rehearsal (release commit `182084b8`). | Trust in Anza's release process. |
| iPhone | No screenshots (iCloud Photos sync); no copy and paste of phrases (Universal Clipboard); turn off Predictive and Auto-Correction while typing phrases (Settings → General → Keyboard). | A compromised phone or browser session defeats all of the above. |

### Seed-phrase derivation finding

`solana-keygen new` derives the key directly from the 12-word seed. Tested with Agave 4.1.2, `solana-keygen recover` and `solana-keygen pubkey ASK` reproduce the same key from the words. **`prompt://` produces a different key from the same words**, because it applies a BIP44 derivation path, as wallet apps such as Phantom do.

The scripts therefore verify backups with `ASK`, and restore uses `solana-keygen recover`. Never import these phrases into a wallet app expecting the same address.

### Hardware wallets and external signers: not supported

No external signer has been verified for this workflow, and none is claimed. Missing capabilities:

- **Ledger (`usb://ledger`):** needs a USB connection from the machine that runs the Solana CLI. An iPhone cannot connect a Ledger to a Codespace.
- **Mobile wallet apps:** they cannot sign `solana program deploy` buffer writes or the CLI's deploy transaction. They would need a dApp page to sign the custom `initialize_config` transaction, and they derive different keys from the same phrase.

Until a signer that the iPhone owner can use is verified for program deployment, upgrade-authority signing, and Anchor instructions, devnet uses owner-held keyfiles in the Codespace. **Mainnet must not use this model.** It requires a hardened multisig with a timelock (`SECURITY_V1.md` §23).

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

## Gate 6: permanent identity (acceptance criteria)

Gate 6 passes only when all of these hold, each checked in CI or by Claude:

1. Five distinct devnet keys exist, generated by the owner in their own Codespace. Upgrade-authority, governance, and guardian backups were verified by re-entry (owner-attested; only public keys leave the Codespace).
2. One program ID across `declare_id!`, `Anchor.toml` (`[programs.localnet]`, `[programs.devnet]`), the IDL `address`, the raw 32 bytes embedded in `royaltyrail.so`, and `deployments/devnet/authorities.json`. CI step: "Verify one program ID across declare_id!, IDL, binary, Anchor.toml, and devnet authorities" (`scripts/devnet/program-id.mjs check`).
3. Built with the pinned toolchain (Anchor 1.2.1, Agave 4.1.2, Rust 1.89.0, `quay.io/ottersec/anchor:v1.2.1`).
4. The CI build writes `MANIFEST.json`: commit, program ID, SHA-256 and sizes, toolchain, CI run, cluster and genesis, and expected authorities. Claude commits it unchanged as `deployments/devnet/manifest.json`.
5. **Deterministic:** the frozen manifest's hashes are reproduced by a second, independent CI build of the manifest commit (CI step "Verify the frozen devnet manifest reproduces"). From then on, every CI build checks that the hashes still reproduce. Any later change to the program build inputs makes CI fail until the manifest is regenerated.
6. All six CI jobs are green on the manifest commit.

## Gate 7: deployment (acceptance criteria)

1. `deploy.sh` deployed the frozen artifact to devnet, after explicit typed owner authorization. It verified:
   - the genesis hash;
   - the committed, unmodified manifest;
   - the artifact checksums and that the artifact is the manifest's build;
   - unchanged program sources;
   - the on-chain upgrade authority;
   - byte-identical deployed bytes.
2. `init-config.sh` initialized ProtocolConfig with governance and upgrade-authority signatures, after explicit typed authorization. The stored governance, guardian, and token program equal the manifest's.
3. `run-lifecycle.sh` completed the 16-participant lifecycle **twice**, reading only the deployer key.
4. Claude ran `tests/e2e/devnet-verify.mjs` against fresh devnet RPC reads at `finalized` commitment, and all checks passed:
   - program, owner, ProgramData, and upgrade authority;
   - binary hash;
   - deployment and initialization transactions and their signers;
   - ProtocolConfig, governance, guardian, and deployment ID;
   - the test mint and its full supply accounting;
   - per run: canonical addresses, and the agreement hash recomputed from on-chain accounts;
   - per run: every allocation and commitment recomputed from its transaction's event with the TypeScript reference;
   - per run: final state, payout rotation, token conservation, inbox solvency, and every recorded transaction.
5. The evidence is committed and all six CI jobs are green on that commit.

Local-validator results never count toward Gate 7.

## iPhone runbook (GitHub Codespaces, devnet only)

Everything below runs in a GitHub Codespace opened in Safari; no local computer is needed. Claude's steps are marked **(Claude)**. Everything else is typed by the owner. **Stop at each Claude step** until Claude replies.

### 0. Before you start

- Protect the GitHub account with a passkey or two-factor authentication.
- In GitHub **Settings → Codespaces**, turn off Settings Sync and set a short default retention period.
- Do not install extensions. Do not run Claude Code or any other agent inside this Codespace. Never open files from `~/royaltyrails-devnet` in the editor.
- On the iPhone, turn off **Predictive** and **Auto-Correction** while typing seed words (Settings → General → Keyboard).
- Have paper and a pen. These keys are **devnet only**: never send them mainnet funds and never reuse them for mainnet.

### 1. Open a Codespace on the PR branch

In Safari, open https://github.com/codespaces/new. Pick repository `gwapupward-hub/RoyaltyRails`, branch `feat/phase-3d-localnet-e2e-v1`, and a 2-core machine, then tap **Create codespace**. If the mobile layout hides the options, use Safari's **aA → Request Desktop Website**. Open a terminal with **☰ → Terminal → New Terminal**. Long-press the terminal to paste.

### 2. Install the verified toolchain

```bash
bash scripts/devnet/codespace-setup.sh
source ~/.bashrc
```

### 3. Generate the keys, verify the backups, publish the public keys

```bash
git pull
bash scripts/devnet/generate-keys.sh
```

For each of the upgrade-authority, governance, and guardian keys, the script:

- shows the 12 words on a separate screen;
- waits until you have written them down, then clears them;
- asks you to type them back (input hidden; press Enter at the passphrase prompt);
- if they don't recover the key, lets you retry, or discards the key and shows a new one.

The program and deployer phrases are never shown. The script writes the keys to `~/royaltyrails-devnet` and prints the five public keys. It records them in `deployments/devnet/authorities.json` and syncs the program ID into `declare_id!` and `Anchor.toml`. Publish only those three public files:

```bash
git add deployments/devnet/authorities.json programs/royaltyrail/src/lib.rs Anchor.toml
git commit -m "chore: freeze devnet program identity"
git push
```

(Alternatively paste the five printed lines to Claude, who applies the same sync.)

### 4. (Claude) Gate 6

Claude:

- checks that the push changed only those public files;
- waits for CI and checks its program-ID consistency step;
- commits the CI `MANIFEST.json` as `deployments/devnet/manifest.json`;
- confirms that the second CI build reproduces the hashes and all six jobs are green;
- records Gate 6 here.

Wait for Claude's reply.

### 5. Fetch and verify the frozen artifact

```bash
git pull
bash scripts/devnet/fetch-artifact.sh
```

This downloads the CI artifact named in the manifest into `./artifact` and checks it against the manifest. If `gh` reports a permissions error, run `gh auth login --web`, finish the device login in Safari, and retry. CI artifacts expire after 90 days.

### 6. Fund the deployer with devnet SOL

```bash
solana address -k ~/royaltyrails-devnet/deployer.json
```

Request devnet SOL for that address at https://faucet.solana.com (sign in with GitHub). Deployment permanently holds about **3.10 SOL** of program rent. It needs about 3.10 SOL more for a temporary buffer, refunded at the end. Each lifecycle run costs about 0.06 SOL. **Fund about 7 SOL.** `deploy.sh` checks the exact minimum.

### 7. Deploy (types `DEPLOY …`)

```bash
bash scripts/devnet/deploy.sh
```

The script checks everything in Gate 7 item 1, prints the program ID, upgrade authority, deployer, commit, and hashes, and deploys only after you type the shown phrase (`DEPLOY` and the program ID's last four characters). It writes `docs/evidence/devnet-deployment.json`.

If a deploy fails midway, its temporary buffer keeps the SOL. Recover it before retrying (this closes only buffers, never the program):

```bash
solana program close --buffers --authority ~/royaltyrails-devnet/upgrade-authority.json \
  --recipient "$(solana address -k ~/royaltyrails-devnet/deployer.json)" --keypair ~/royaltyrails-devnet/deployer.json
```

### 8. Initialize the permanent configuration (types `INITIALIZE …`)

```bash
bash scripts/devnet/init-config.sh
```

This shows the permanent governance and the guardian. After you type the shown phrase, it initializes ProtocolConfig with the governance and upgrade-authority signatures and a new six-decimal test mint. It writes `docs/evidence/devnet-config.json`.

### 9. Run the 16-participant lifecycle twice

```bash
bash scripts/devnet/run-lifecycle.sh
```

This uses only the deployer key and writes `docs/evidence/devnet-lifecycle-<time>-run1.json` and `-run2.json`.

### 10. Hand back the public evidence

```bash
git add docs/evidence/
git commit -m "docs: add devnet deployment and lifecycle evidence"
git push
```

### 11. (Claude) Gate 7

Claude runs `tests/e2e/devnet-verify.mjs` against devnet, commits `docs/evidence/devnet-verification.json`, completes this record, and confirms CI.

### 12. After verification

Delete the key files (`rm -r ~/royaltyrails-devnet`) or the whole Codespace. Keep the paper backups: they are the only remaining copy of the upgrade-authority, governance, and guardian keys. To restore one later:

```bash
solana-keygen recover --outfile ~/royaltyrails-devnet/<name>.json
```

Enter the 12 words and press Enter at the passphrase prompt. Confirm that `solana-keygen pubkey` matches the recorded public key. Never use `prompt://` for these keys (see the derivation finding).

## Who does what

| Action | Owner (iPhone) | Claude | GitHub Actions |
|---|---|---|---|
| Create, stop, delete the Codespace | ✓ | | |
| Generate keys, write and verify paper backups | ✓ | | |
| Push the three public identity files | ✓ | | |
| Program-ID consistency, build, manifest, reproducibility | | | ✓ |
| Freeze the manifest; record Gate 6 | | ✓ | |
| Faucet, fetch artifact, deploy, initialize, lifecycle | ✓ | | |
| Push the public evidence | ✓ | | |
| Independent devnet verification; record Gate 7 | | ✓ | |
| Delete keys or Codespace; keep paper backups | ✓ | | |
| Review and merge PR #9 | ✓ | | |

## Local-validator rehearsal of this procedure

The complete procedure above was rehearsed on a local validator, in a disposable checkout, with throwaway keys (since deleted). The scripts are the ones in this commit.

- **Setup:** `codespace-setup.sh` ran in a fresh home directory. It downloaded and verified the Agave archive and installed both lockfiles. With a tampered pinned hash, it refused and installed nothing.
- **Key generation** ran under a pseudo-terminal:
  - phrases appeared only on the alternate screen;
  - a wrong backup was rejected and the correct one accepted;
  - the result was five distinct keys with mode 600 in a mode 700 directory, no staging leftovers, and the public authorities file plus the program-ID sync.
  - It refused: an agent shell, a CI shell, a non-interactive shell, an in-repository key directory, existing keys, and an already-recorded identity.
- **Build and freeze:**
  - The CI-equivalent build found one program ID across all five sources, with one embedded copy in the binary.
  - The manifest was frozen, and a clean rebuild reproduced it byte for byte.
  - After a later program-source change, both the CI gate and the deploy-time artifact check failed as stale.
- **Deploy:**
  - It refused: a devnet target from an agent shell, a tampered artifact, a wrong authorization phrase, a non-interactive shell, and a re-deploy.
  - The authorized deploy verified the upgrade authority and byte-identical bytes.
- **Initialization:** refused while the governance key was absent. With it present, it initialized with both signatures (`initialize_config` 11,921 and 16,421 CU in two rehearsals).
- **Lifecycle:** both runs passed with only the deployer key present.
- **Verification:**
  - `devnet-verify.mjs` passed 21 of 21 checks.
  - It failed, as intended, against each tampered input: a changed claim amount, a substituted governance key, a different binary hash, and a missing second run.
- **CI localnet lanes on an ID-frozen tree:** `anchor keys sync` replaces only `[programs.localnet]`. The devnet-lifecycle rehearsal then passed twice (initialize, then reuse).

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
4. **Upgrade authority is a superuser.** One key can replace the bytecode and with it every protection, including "no admin withdrawal", and it now also approves the one-time config initialization. Devnet uses one owner-held key; mainnet requires a hardened multisig with a timelock and monitoring.
5. **Governance is permanent.** v1 cannot rotate governance. Losing the governance key permanently removes unpause and guardian rotation for that deployment; the guardian can still pause.
6. **Cloud key custody.** Devnet keys are plaintext files on a GitHub-hosted Codespace (see *Threat model*). Acceptable only because devnet value is nil. No external signer is verified for an iPhone-only owner.
7. **Dependency code beside keys.** Integrity-locked npm packages run in the same process as the deployer key, and during initialization the governance and upgrade-authority keys.
8. **Build verification.** The artifact is built by CI in a pinned container (by tag, not digest), its hashes are frozen, and later CI builds must reproduce them. It is not a `solana-verify` verifiable build, and reproducibility outside that container has not been demonstrated.
9. **Pre-deployment window.** Between the identity commit and deployment, whoever holds the program keypair can deploy first. It never leaves the owner's Codespace, but deployment should follow Gate 6 promptly.
10. **Devnet is not durable.** Devnet can be reset. The recorded signatures and this document remain the evidence of record.

Resolved in Stage 3D.4: **first-caller configuration initialization** (see above).
