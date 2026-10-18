# Phase 3D — Local Validator & Devnet E2E

## Baseline

Phase 3D begins from merged `main` commit `33e1dff765377ef0681d96c25d773cc8ae03b25c` (`Merge Phase 3C settlement execution`). That exact merge commit passed the post-merge TypeScript reference/spec job and locked Rust parity job.

Phase 3C established the v1 settlement execution surface. Phase 3D does **not** redesign protocol economics. Its job is to prove that the merged Anchor program behaves correctly as a deployed Solana program.

## Objective

Produce reproducible local-validator end-to-end evidence for the complete v1 lifecycle and establish a safe, explicit path to the first devnet deployment.

The minimum successful flow is:

1. build the Anchor program and generated IDL
2. start an isolated local validator
3. create a six-decimal mint under the original SPL Token Program
4. initialize `ProtocolConfig`
5. register a Work and RevenuePool
6. propose and unanimously approve an initial AgreementVersion
7. activate the agreement
8. initialize the canonical Royalty Inbox ATA owned by the agreement vault PDA
9. exercise direct `fund_and_allocate`
10. exercise address-only deposit + permissionless `allocate_inbox`
11. claim participants independently through vault-PDA-signed checked transfers
12. rotate one participant payout wallet and prove later claims route only to the new canonical ATA
13. verify account state, SPL balances, events/commitments, nonce behavior, allocation sequence behavior, and conservation invariants after every transition

## Frozen Phase 3D constraints

- Keep Phase 2/3 economic semantics unchanged unless an E2E test proves an implementation defect.
- One immutable settlement mint per deployment.
- Original SPL Token Program only.
- Six-decimal settlement precision.
- Canonical Royalty Inbox remains the ATA of `[b"vault", agreement]` for the configured mint and token program.
- `fund_and_allocate` is the only path that mutates `direct_funding_nonce`.
- `allocate_inbox` never mutates `direct_funding_nonce`.
- Every allocation increments `allocation_sequence` exactly once.
- Claims mutate only the selected participant's `cumulative_claimed` settlement state.
- No admin withdrawal, recipient override, arbitrary allocation, or retroactive economic edits.
- No protocol settlement fee is introduced in this phase.

## Toolchain lock

Phase 3D must continue to use the repository's pinned toolchain:

- Anchor CLI / crates / TypeScript client: `1.2.1`
- Solana / Agave CLI: `4.1.2`
- Rust: `1.89.0`
- Node: `22` in CI
- `@anchor-lang/core`: `1.2.1`
- legacy `@solana/web3.js` 1.x client line
- legacy-compatible `@solana/spl-token` client line

Do not silently upgrade toolchains while debugging E2E failures.

## Program identity policy

The current `declare_id!` / localnet ID is still a development identity. It may be used for local-validator proof.

Before the first devnet deployment:

1. generate a permanent devnet program keypair in a secure environment
2. never commit the secret keypair to the repository
3. run `anchor keys sync` against that keypair
4. commit only the resulting public program ID updates (`declare_id!`, `Anchor.toml`, generated public metadata if applicable)
5. build again after the ID sync
6. record the program ID, deployment transaction/signature, binary hash, IDL hash, cluster, deployer public key, and exact source commit in a deployment manifest

A devnet deployment is not authorized from an ephemeral CI keypair.

## Stage 3D.1 — Deterministic Anchor build gate

Add a CI lane that installs the pinned Anchor/Solana toolchain and proves the program can produce its SBF artifact and IDL from a clean checkout.

Required checks:

- pinned CLI versions resolve exactly
- `anchor build --ignore-keys` succeeds while the local development identity is still temporary
- generated IDL contains the complete lifecycle plus settlement instruction surface
- generated artifacts are not committed unless explicitly designated as release artifacts
- existing TypeScript reference and Rust parity jobs remain green

## Stage 3D.2 — Local-validator lifecycle harness

Add a TypeScript E2E harness using Anchor v1 client packages and legacy Solana JS/SPL Token clients.

The harness must create fresh test state per run and must not depend on external RPCs, faucets, or secrets.

Positive-path assertions must cover:

- config initialization with a six-decimal legacy SPL mint
- Work and RevenuePool registration
- initial agreement proposal, participant approvals, activation
- Royalty Inbox idempotent initialization
- direct funding with exact expected nonce
- allocation commitment / sequence advancement
- independent claims
- raw external deposit followed by `allocate_inbox`
- superseded agreement historical settlement behavior
- payout-wallet rotation followed by a claim to the new canonical destination

Status: **passing.** `tests/e2e/positive-lifecycle.mjs` (Anchor.toml script `test`) runs in the CI job "Local validator positive lifecycle" against a fresh `solana-test-validator`.

## Stage 3D.3 — Adversarial local-validator matrix

The on-chain harness must attempt and reject at least:

- wrong settlement mint
- Token-2022 / wrong token program substitution
- wrong vault PDA
- wrong Royalty Inbox address
- wrong Royalty Inbox mint/authority
- wrong payer source mint/authority
- stale direct-funding nonce replay
- double inbox allocation at unchanged balance/state
- wrong payout ATA address
- wrong payout ATA mint/authority
- stale payout route after wallet rotation
- claim while claims are paused
- allocation while allocations are paused
- claim for a fully claimed participant
- settlement against non-settleable agreement state
- any transition that would make the inbox insolvent

Each rejection must also prove that the failed transaction left SPL balances and protocol state unchanged.

Status: **passing.** `tests/e2e/adversarial-matrix.mjs` (Anchor.toml script `test-adversarial`) lands 68 invalid transactions on a fresh validator in the CI job "Local validator adversarial matrix", including five attempts to front-run configuration initialization. Every one is rejected with its expected error code, and every tracked protocol, SPL token, and mint account is byte-identical before and after. Every item above is covered. Two caveats: the inbox and payout mint/authority substitutions are rejected by the canonical-address check, which precedes the field checks. Inbox insolvency cannot be induced by an external caller; its on-chain attack paths are rejected and its guard is unit-tested. Stage 3D.3 changed no program code, and its original matrix found no defect. The configuration-initialization race was identified afterwards and fixed in Stage 3D.4. Full matrix, rollback method, coverage classification, limitations, and reproduction steps: [`PHASE_3D3_ADVERSARIAL_EVIDENCE.md`](PHASE_3D3_ADVERSARIAL_EVIDENCE.md).

## Stage 3D.4 — Devnet readiness

After the local-validator gate is green:

- freeze the permanent devnet program ID
- prepare the deployer wallet outside the repository
- fund only the minimum devnet SOL required
- perform a verifiable or otherwise reproducibly pinned build where practical
- deploy to devnet
- execute the same minimum lifecycle flow against devnet using a dedicated test mint
- write `docs/DEPLOYMENT_DEVNET_V1.md` with exact evidence

Devnet proof is a deployment/integration milestone, not a smart-contract security audit.

Status: **identity frozen (owner commit `20ccae9`, program `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB`); manifest frozen; Gate 6 PASS pending the second CI build's reproducibility check and owner custody attestation; Gate 7 BLOCKED on owner deployment. Not deployed.** No private key may exist in CI or an agent runtime. Prepared and rehearsed end to end on a local validator:

- **Initialization front-running is closed.** `initialize_config` requires the program's current upgrade authority as co-signer, verified against this program's ProgramData (`CFG-04` to `CFG-08`).
- **Owner-custodied signing model.** Every key is generated and used only in the owner's Codespace. Each step reads only the keys it needs: lifecycle runs read only the deployer, and the governance key is read only during initialization. Deployment and initialization require typed owner authorization. Key-using scripts refuse agent and CI shells on devnet.
- **Verified backups.** `generate-keys.sh` shows each lasting key's seed phrase only on the terminal's alternate screen and verifies the paper backup by re-entry (`solana-keygen pubkey ASK`; `prompt://` derives a different key). It refuses to overwrite keys and outputs only public keys.
- **Supply chain.**
  - The Solana CLI is installed from the Agave release archive verified against a pinned SHA-256.
  - E2E client libraries are installed from an integrity-locked lockfile (`tests/e2e/package-lock.json`) with install scripts disabled, in CI and in the Codespace.
- **Gate 6 automation.**
  - CI verifies one program ID across `declare_id!`, `Anchor.toml`, the IDL, the binary's embedded bytes, and the recorded authorities.
  - It writes a deployment manifest into the artifact.
  - Once the manifest is frozen, CI requires every later build of the same sources to reproduce its hashes.
- **Gate 7 automation.**
  - `deploy.sh`, `init-config.sh`, and `run-lifecycle.sh` (16 participants, twice) validate the genesis hash, the frozen manifest, and the artifact before signing.
  - `tests/e2e/devnet-verify.mjs` independently verifies everything from fresh `finalized` RPC reads, recomputing the agreement hash, allocations, and commitments with the TypeScript reference.
- The adversarial harness tolerates web3.js's two ways of reporting a landed failure, which removes a latent race-dependent flake.

Remaining, in order (`DEPLOYMENT_DEVNET_V1.md` has the exact commands and acceptance criteria):

1. ~~The owner publishes the five public addresses~~: done in `20ccae9` (owner-controlled machine; `prepare-authorities.sh`).
2. ~~Claude freezes the CI manifest~~: done. A second CI build must reproduce it with all six jobs green, and the owner attests custody (Gate 6).
3. The owner fetches the frozen artifact, deploys, initializes, and runs the lifecycle, then pushes the public evidence.
4. Claude verifies the deployment against devnet and records it (Gate 7).

Hard-gate items 6 and 7 are not yet met.

## Explicit non-goals

Phase 3D does not include:

- mainnet deployment
- RoyaltyRails Studio UI
- production SDK ergonomics beyond what is necessary for the E2E harness
- monetization changes
- protocol fee changes
- new settlement assets
- Token-2022 support
- external security-audit signoff

## Hard gate

Phase 3D is complete only when all of the following are true:

1. clean-checkout Anchor/SBF + IDL build is reproducible under pinned tooling
2. local-validator positive lifecycle passes end to end
3. local-validator adversarial matrix passes and proves rollback/no-mutation on failures
4. direct funding, inbox allocation, independent claims, and payout rotation are proven with real SPL token movement
5. exact-head reference/spec, Rust parity, and E2E CI are green together
6. permanent devnet program identity is frozen securely
7. devnet deployment evidence and an end-to-end devnet smoke flow are recorded

Do not start the public SDK/UI phase from assumptions. Start it from the exact merged Phase 3D interface and deployment evidence.
