# Phase 3E — RoyaltyRails Protocol Identity & Metadata

**Status:** IN PROGRESS — repository preparation only. Canonical on-chain metadata has **not** been published; the devnet binary and authorities have **not** been changed.

## Prerequisites / source of truth

- Phase 3D was merged in PR #9 (merge commit `114d6fcd36b45a87086c95eb13c1b80194b3e800`).
- Public identity source: [`deployments/devnet/protocol-identity.json`](../deployments/devnet/protocol-identity.json).
- Frozen manifest: [`deployments/devnet/manifest.json`](../deployments/devnet/manifest.json). This frozen file **must not be edited**.
- Deployed devnet Program ID: `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB`.
- Upgrade authority: `CEhT8a7FrvN7uGCZRruMKp6uzAMusaFQ4XPDRo5i6wSg`.
- The technical crate/library and Anchor namespace remain `royaltyrail` to preserve compatibility.

## Public presentation

| Surface | Official value |
|---|---|
| Protocol | **RoyaltyRails Protocol** |
| Brand | **RoyaltyRails** |
| Developer program identifier | `royaltyrail` |
| Network | **Solana devnet only** |
| Repository and interim canonical project URL | https://github.com/gwapupward-hub/RoyaltyRails |
| Description | A Solana protocol for participant-approved royalty and revenue-sharing agreements, deterministic revenue allocation, and independently claimable settlement payouts. |

The project is **not audited or approved for real-customer funds**. Source-to-binary reproducibility checks do not constitute an external security audit.

## Boundaries

- **No** smart-contract logic changes, deployment, program upgrade, program ID change, permission changes, settlement-mint change, or governance change in Phase 3E.
- **No** private-key or phrase material in GitHub, chat, CI or artifacts. Existing devnet-only custody exception remains.
- Do not represent the planned Phase 3F Basic 0.25% / Premium Security 1.00% fees as live. The existing on-chain v1 fee remains 0%.
- An upgrade-authority-signed metadata transaction is still an on-chain mutation: prepare and validate first; stop for owner approval before submission.

## Stage A — Repository preparation

1. Confirm current main, PR #9 merge, frozen manifest, on-chain byte hash and upgrade authority with finalized RPC.
2. Record the official identity and canonical links, using public values only.
3. **Draft created:** [`deployments/devnet/security-metadata.json`](../deployments/devnet/security-metadata.json), using the documented Solana Program Metadata `security` fields (`name`, `description`, `project_url`, `contacts`, `policy`, `preferred_languages`, `source_code`, and the frozen source `source_revision`). Validate using a pinned compatible CLI before proposing publication. **Do not invent logo URL, release version, auditors, audit status, or verified-build status.**
4. **Owner contact provided:** `thagwapspot@gmail.com` (owner-designated, not independently email-delivery verified). The repository draft disclosure policy is [`SECURITY.md`](../SECURITY.md), and the canonical publication payload is [`security-metadata.json`](../deployments/devnet/security-metadata.json). The policy URL is an immutable GitHub commit permalink so it can resolve before PR merge. Owner must review the public policy/content before publication. Do not publish the `security` record until payload, contacts and policy URL are rechecked and the owner authorizes the transaction.
5. **Artifact recovered and hashed:** The exact 78,057-byte frozen Anchor IDL was recovered from the Phase 3D CI artifact. Its SHA-256 is `07bbfcef23e27cac32cbee5aed4fcd1aeb0c1e837ef9febf28f0472b670449fa`, and it embeds the expected devnet program ID. PMP schema/client acceptance and Codama compatibility still require a separate controlled rehearsal. The exact original bytes remain retrievable from GitHub Actions run `39092819552`.
6. Pin CLI/dependencies (no unpinned `npx @latest` for production signing). Review CLI behavior, payer, upgrade-authority inputs, network URL, metadata PDA derivations, rent, and current Solana program-metadata implementation.

## Security contact and disclosure status

- Owner-designated reporting address: **thagwapspot@gmail.com**.
- Public disclosure policy drafted in [`SECURITY.md`](../SECURITY.md); not merged to `main` or independently checked for email delivery. The metadata policy URL is a verified **commit permalink**, not a default-branch URL, to avoid the publication-before-merge circular dependency.
- Proposed canonical PMP `security` JSON: [`deployments/devnet/security-metadata.json`](../deployments/devnet/security-metadata.json) (repository draft **only**, no on-chain upload).
- The public metadata record may be displayed by explorers that support the PMP security seed; appearance of the official protocol name in all explorers cannot be guaranteed.
- On-chain publication requires separate **explicit** authorization and signer preflight.

## Phase 3E preparation evidence (verified locally; not on-chain)

- Recovered the precise frozen SBF and Anchor IDL from GitHub Actions run `39092819552`, artifact ID `12123238615`. Their byte lengths and SHA-256 digests, and the frozen `MANIFEST.json` digest, matched the documented Phase 3D records. See [IDL provenance](evidence/phase-3e/idl-provenance.json).
- Prepared [keyless identity / artifact verification](../scripts/phase3e/verify-identity.mjs) and [PMP PDA verification](../scripts/phase3e/verify-pdas.mjs), now wired into the repository CI lanes. The Phase 3E branch's checks must still finish green.
- Canonical PMP PDA derivation (accounts not yet queried in this record): `idl` = `6Au73HiMX852zhgyTuYNkYDQHZWiCb6rxZ4EsVyyc2p3`, `security` = `6yKDZVfqNwoDDBkSUBG2t2U6aApcNmqC8MtYGuPYDSxb`.
- Added a read-only finalized-RPC [publication preflight](../scripts/phase3e/devnet-preflight.mjs); no successful live invocation is claimed yet.
- The [controlled publication plan](PHASE_3E_PUBLICATION_PLAN.md) records required CLI provenance, isolated Node >=24 compatibility, account/rent review and exact owner authorization.
- **Current status: preparation in progress; no canonical PMP account creation or on-chain publication.**

## Stage B — Keyless validation and preflight

1. Verify Solana genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, program ID, ProgramData upgrade authority, frozen deployed byte hash, config, and both Stage 3D lifecycle evidence files.
2. Produce the exact expected `idl` and `security` PMP metadata addresses, JSON/file hashes, funding estimate, and transaction/signer plan; report whether these PDAs already exist.
3. Test the metadata publication flow on a local validator or isolated disposable devnet program; do not touch the actual RoyaltyRails program during rehearsal.
4. Independently assess whether third-party Solana Verified Builds tooling can reproduce the frozen Anchor 1.2.1/Agave 4.1.2/Rust 1.89.0 artifact. **Do not claim Explorer/OtterSec verified status based solely on the repository's reproducible CI.** Remote verification might not be supported on devnet.
5. Re-run all existing repository CI and frozen artifact checks; keep Phase 3D manifest immutable.

## Stage C — Owner authorization gate (STOP)

Before any transaction, provide:
- finalized exact metadata content, program ID, devnet genesis, expected metadata accounts, versions, publisher/upgrader authority, payer, estimated devnet SOL;
- transaction-specific potential risks, source of the signing environment, and confirmation that no secrets leave the owner-approved environment;
- results of dry run, availability/compatibility of Explorer and IDL Explorer, and an **explicit request for owner authorization**.

**Do not sign, simulate with sensitive keys in an agent runtime, broadcast, publish, upgrade, or merge as a substitute for approval.**

## Stage D — Publication and independent verification (only after owner approval)

1. Publish the canonical PMP IDL and `security` records to **devnet**, using the correct upgrade authority and independently verified metadata payloads. The official security contact is `email:thagwapspot@gmail.com`; the policy points to the immutable public GitHub commit permalink containing `SECURITY.md`.
2. Save transaction signatures, slot, account addresses, file hashes, decoded content, publisher authority and independent finalized-RPC verification under `docs/evidence/phase-3e/`.
3. Check `https://idl.solana.com` and other supported explorer views on **devnet**. Explorer label display is not guaranteed and is not required if the canonical records are discoverable and verified.
4. Check program bytes and governance are unchanged. Record whether external source verification succeeded, failed, or was unavailable, without overstating it.

## Exit criteria

- Official public naming consistent in README, identity file and current reference documentation.
- Canonical IDL and `security` metadata published and independently read from devnet, **if supported and after authorization**; otherwise clearly mark BLOCKED with the technical reason.
- Public evidence for exact metadata account contents; no fabricated audit claims.
- Frozen Phase 3D program hash and authority unchanged.
- No secrets in GitHub, CI, logs or artifacts.
- Phase 3E PR reviewed and required CI passing; **no automatic merge**.

## Authoritative technical references

- Solana Program Metadata: https://github.com/solana-program/program-metadata
- Solana IDL Explorer publishing guide: https://idl.solana.com/docs
- Solana verified builds: https://solana.com/docs/programs/verified-builds

**Next milestone after Phase 3E:** Phase 3F two-tier protocol fee engine (Basic 25 bps, Premium Security 100 bps); Phase 4 SDK / integrations / Studio follows. These fees are **approved requirements, not deployed functionality**.
