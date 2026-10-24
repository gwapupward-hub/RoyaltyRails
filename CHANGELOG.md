# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The protocol is not versioned for release yet; entries are grouped by engineering phase and merged pull request. RoyaltyRails is devnet-only and unaudited. No entry here implies mainnet readiness.

## [Unreleased]

### Added
- SoundReceipt v1 PRD (`docs/SOUNDRECEIPT_V1_PRD.md`, PR #11) and isolated, non-production schema and OpenAPI foundation in `apps/soundreceipt/` (PR #12). Outside the protocol audit scope.

## Phase 3E — Protocol identity and metadata (in progress)

### Added
- Official public identity **RoyaltyRails Protocol**; the deployed technical name stays `royaltyrail` (`deployments/devnet/protocol-identity.json`).
- `SECURITY.md` disclosure policy and security contact.
- Draft program security metadata (`deployments/devnet/security-metadata.json`) and a keyless identity verifier (`scripts/phase3e/verify-identity.mjs`) that pins it to the frozen Phase 3D manifest.
- Keyless devnet preflight and PMP metadata PDA checks.

### Not yet done
- Canonical on-chain IDL and security-metadata publication (owner authorization gate, `docs/PHASE_3E_OWNER_AUTHORIZATION.md`).

Merged in PR #10 (2026-10-24).

## Phase 3D — Local validator and devnet E2E (2026-10-18)

### Added
- Deterministic Anchor SBF and IDL build gate in a pinned container, with program-ID consistency checks across `declare_id!`, `Anchor.toml`, the IDL, the binary, and the recorded authorities.
- Local-validator positive lifecycle, adversarial matrix, and devnet-lifecycle rehearsal suites.
- Frozen devnet deployment manifest (`deployments/devnet/manifest.json`); every later build of the same sources must reproduce its hashes.
- Devnet deployment of program `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB`, two 16-participant lifecycle runs, and an independent finalized-RPC verifier (21/21 checks). See `docs/DEPLOYMENT_DEVNET_V1.md`.

### Security
- `initialize_config` requires the program's current upgrade authority as co-signer, which closes first-caller configuration initialization.
- Devnet keys were handled under an owner-accepted, devnet-only custody exception. Never reuse those keys or that custody model beyond devnet.

Merged in PR #9.

## Phase 3C — Settlement execution (2026-10-17)

### Added
- Royalty Inbox, `fund_and_allocate`, permissionless `allocate_inbox`, and per-participant `claim_participant` through vault-PDA-signed checked transfers.

## Phase 3B — Lifecycle and authorization state machine (2026-10-16)

### Added
- Agreement proposal, unanimous approval, activation, supersession with old- and new-set consent, and participant payout-wallet rotation (PR #7).

## Phase 3A — Anchor foundation and Rust parity (2026-10-15)

### Added
- Anchor program skeleton, `royaltyrail-core` crate, and TypeScript/Rust allocation parity vectors (PR #6).

## Phases 1–2 — Reference engine and protocol specification (2026-10-14 to 2026-10-15)

### Added
- TypeScript reference allocation engine with 100,000,000-share-unit accounting (PR #1).
- v1 protocol, accounting, state-machine, security, account-layout, Agreement Manifest, and integration specifications (PR #2).
