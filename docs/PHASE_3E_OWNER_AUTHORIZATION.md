# Phase 3E — Owner Authorization Record (Devnet Only)

**Status:** Owner explicitly approved publishing the exact RoyaltyRails canonical `idl` and `security` metadata records to **Solana Devnet**, subject to final approval-sheet review and signing preflight. This document records the scope of the approval; **it is not proof of a transaction or an on-chain authorization**.

**Approval date:** 2026-10-18. The owner replied “Approved” to the explicit Phase 3E publication-authorization request.

## Authorized scope

| Item | Authorized value |
| --- | --- |
| Cluster | Solana **Devnet**; genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| RoyaltyRails deployed program | `Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB` |
| Program upgrade authority | `CEhT8a7FrvN7uGCZRruMKp6uzAMusaFQ4XPDRo5i6wSg` |
| Proposed SOL payer | `Gpub3uSCyGZDpHGMeRmnw3a7cf1X2usW41ioLDaSgQMa` |
| Program Metadata Program | `ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S` |
| Canonical `idl` PDA | `6Au73HiMX852zhgyTuYNkYDQHZWiCb6rxZ4EsVyyc2p3` |
| Canonical `security` PDA | `6yKDZVfqNwoDDBkSUBG2t2U6aApcNmqC8MtYGuPYDSxb` |
| IDL payload | **78,057 bytes**, SHA-256 `07bbfcef23e27cac32cbee5aed4fcd1aeb0c1e837ef9febf28f0472b670449fa` |
| Security payload | **689 bytes**, SHA-256 `1d5d8bb28d9da630a86763caafd142cf5916ca787b097db9272356fba8e849fb` |
| Security email | `email:thagwapspot@gmail.com` |
| Security policy | `https://github.com/gwapupward-hub/RoyaltyRails/blob/07c7f90c648ae27a170b7961d54d1dbd58a9df6f/SECURITY.md` |
| Reported unsigned CLI export | 8 IDL transactions + 1 security transaction, `--priority-fees 0` |
| Reported estimated SOL requirement | `0.037707400 SOL` excluding retries, possible account/state changes and later priority fees |

Source evidence: the owner-provided Phase 3E final preparation report and the committed Phase 3E hash/PDA records. The reported 8+1 instruction plan and estimate **have not been independently inspected in this repository** because the generated local `/tmp` artifacts have not been supplied or committed.

## Preconditions — MUST PASS before signing

1. Owner directly reviews the complete **transaction-specific approval sheet**, security payload, policy URL and unsigned instruction list, and confirms that the steps still match this authorization. Obtain sanitized final report and instruction plans from the environment that produced them; never commit secret key paths, encrypted secrets, private keys, RPC tokens, mnemonics or signatures in progress.
2. Recompute both payload hashes from **the exact files used for publication**, not a regenerated or reformatted IDL. Confirm CLI package/dependency integrity and the isolated Node >=24 environment.
3. Recheck **finalized** Devnet genesis, upgrade authority, current deployed SBF SHA-256, and whether both canonical PMP accounts exist. If accounts unexpectedly exist, binary/authority changed, or a payload digest differs, **STOP** and request a new owner decision.
4. Review the actual CLI instructions, fee payer and upgrade-authority signer roles, rent and fees; verify the payer has adequate Devnet SOL plus a cautious retry buffer. Payer address and authority public keys must match.
5. Execute only in the owner's independently controlled signing environment. **Do not expose devnet key files or recovery phrases to chat, autonomous agents, CI, GitHub, logs or reports.** Keys from the devnet custody exception must never be reused for mainnet.
6. If the signing environment does not permit human-authorized operation without disclosing keys to an agent, **STOP**. Use a human-operated or hardware/multisig signing method compatible with the metadata tooling. Do not copy the keys into an agent to bypass the constraint.

## Authorized changes

- Create/populate only canonical Program Metadata **IDL** and **security** accounts for the specified Devnet program, using the approved exact payloads. Do not silently convert or mutate the frozen Anchor IDL.
- Record each transaction signature and finalized post-state; handle any partial publication carefully, re-inspecting state before retrying so completed transactions are not blindly replayed.

## NOT authorized

- Any RoyaltyRails program upgrade, redeployment, new program ID, authority rotation, guardian or governance change, settlement instruction change, or mint change.
- Mainnet publication, mainnet key reuse, live-customer funds, disabling security gates, fee activation, or Phase 3F/4 execution.
- Additional or different metadata accounts, an IDL conversion with a new hash, an unapproved policy/recipient change, or spending beyond the owner-reviewed amount/plan without renewed confirmation.
- Auto-merging PR #10 on the strength of approval alone.

## Verification and completion

After publication, independently query the canonical PMP records at **finalized** commitment, compare decoded content to the exact approved payloads, record account addresses, signatures, slots, and hashes in `docs/evidence/phase-3e/`, and rerun the independent RoyaltyRails 21-check verifier. Assert deployed SBF hash and governance are unchanged. Confirm what IDL Explorer and Solana Explorer **actually** display; no explorer-label guarantee.

**Current state:** APPROVED IN PRINCIPLE, **NOT PUBLISHED**. No transaction has been submitted by this approval record. The approval remains conditional on the complete owner-sheet review and immediate signing preflight.
