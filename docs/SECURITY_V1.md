# RoyaltyRail Security Model v1

Status: Phase 2 hardened freeze candidate  
Date: 2026-10-15

## 1. Security objective

Once an agreement version is validly approved and activated:

> Revenue can only be economically allocated according to the exact approved terms, and a participant's claimable revenue can only be delivered using payout routing controlled by that participant authority.

RoyaltyRail does not determine whether the human-entered legal/business terms are correct. It guarantees deterministic execution of the approved configuration.

## 2. Trusted boundary

Trusted for protocol correctness:

- Solana runtime atomicity and account locking;
- deployed RoyaltyRail bytecode;
- original SPL Token Program;
- configured native USDC mint;
- PDA derivation;
- Rust implementation matching canonical TypeScript allocation/hash vectors;
- participant signatures for economic approval and predecessor supersession consent.

Not trusted:

- RoyaltyRail Studio/API/indexer/keepers;
- RPC providers;
- manager/proposer;
- payer;
- allocation/claim triggerer;
- guardian/governance authority;
- external metadata hosts;
- invite infrastructure;
- caller account labels/order;
- reconciliation references as uniqueness proofs.

Security-critical relationships are re-derived or constrained on-chain.

## 3. Economic invariants

```text
participant_count in 1..=16
sum(shares) == 100_000_000 share units
all shares > 0
sum(current allocations) == newly allocated amount
sum(cumulative_allocated) == cumulative_gross
0 <= cumulative_claimed_i <= cumulative_allocated_i
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

Canonical allocation math never requires clawback allocation, and each participant's lifetime proportional allocation deviation stays strictly below one settlement-asset base unit.

## 4. Pure allocation boundary

The TypeScript/Rust allocation engine contains only:

```text
agreement shares
cumulative gross/allocation state
new amount
```

It does not contain direct funding nonce, wallets/token accounts, claims, Solana CPI logic, or payment references.

`fund_and_allocate` and `allocate_inbox` invoke identical percentage math with different protocol replay semantics. Direct nonce is checked/incremented only by direct funding; inbox allocation never consumes it.

## 5. Replacement-consent invariant

A manager cannot remove/reduce an existing participant by omitting them from a replacement proposal.

Replacement activation requires:

- unanimous approval by proposed participants; and
- unanimous supersession consent from current predecessor participants to the exact new agreement hash.

Required adversarial case:

```text
v1 = Alice 60 / Bob 40
proposed v2 = Alice 100
Alice approves proposed v2
activation MUST fail until Bob approves supersession
```

A one-recipient successor is valid after all required old/new consent exists.

## 6. Economic identity vs creative metadata vs payout routing

Core on-chain economic identity binds:

```text
participant authority
share units
```

Detailed music roles/credits are deliberately **not** independent on-chain economic fields. They may be multi-valued and evolve with industry vocabularies, so they live in the deterministic Agreement Manifest and are cryptographically anchored by `terms_hash`.

Payout wallet is separate participant-controlled routing state.

Only participant authority may rotate that participant's payout wallet. Manager, governance, guardian, claim triggerer, payer and other participants cannot redirect it.

Required test:

```text
B rotates payout wallet B1 -> B2
agreement hash unchanged
B share unchanged
A routing unchanged
future B claim uses ATA(B2, USDC)
```

## 7. Pull-claim liveness

Allocation and claims are separate. A missing/frozen/unusable recipient destination must not block another participant.

Each claim references one participant and one canonical current payout ATA. Failed claim transaction changes no state. Studio/third-party keepers may automatically submit claims, but correctness/liveness does not require RoyaltyRail's keeper.

## 8. Claim amount width proof

SPL token-account amount is `u64`.

From solvency:

```text
sum(all current claimable) <= inbox_balance <= u64::MAX
```

Therefore every participant's current claimable amount is `<= u64::MAX`. Lifetime cumulative values remain `u128`, but no valid solvent state requires a wider current SPL transfer.

Phase 3 must include an invariant test proving this relationship.

## 9. USDC issuer controls

An original SPL Token account can be frozen when the mint retains freeze authority. A frozen account cannot receive, transfer or burn until thawed.

RoyaltyRail mitigates recipient-account freeze by independent claims + participant payout rotation. RoyaltyRail cannot eliminate issuer-level controls over native USDC. If the Royalty Inbox itself is frozen by the issuer, RoyaltyRail cannot transfer those tokens. This external settlement-asset dependency must be disclosed.

## 10. Asset boundary

One configured settlement mint and original SPL Token Program per deployment.

Reject lookalike USDC, arbitrary caller mints, Token-2022 accounts, wrong-mint source/destination accounts, wrong Token Program, uninitialized mint, and unexpected decimals for configured USDC deployment.

Implementation should use checked transfer semantics with explicit mint decimals.

## 11. Direct payer source

Direct funding source need not be an ATA.

Verify:

- source owned by configured Token Program;
- source mint equals configured settlement mint;
- source token authority equals propagated payer signer;
- positive sufficient amount.

Delegated SPL authority/multisig source support is outside v1 unless separately specified/tested.

## 12. Royalty Inbox authority

Vault PDA:

```text
[b"vault", agreement_version]
```

Royalty Inbox is exact canonical ATA for vault PDA + configured USDC mint + configured Token Program.

No v1 equivalent of these may exist:

```text
admin_withdraw
rescue_to_arbitrary_destination
override_claim_destination
force_custom_allocation
edit_share
```

Audit must inspect actual instruction/CPI inventory, not merely documentation.

## 13. External deposit / dust / concurrency attacks

Anyone can send configured USDC to a public Royalty Inbox.

Test arbitrary sequences of:

```text
external_deposit
fund_and_allocate
allocate_inbox
claim_participant
```

including dust, micro-deposits and races.

The invariant:

```text
unallocated = inbox_balance - allocated_unclaimed
```

must hold after every successful transition.

## 14. Wrong raw deposit risk

Raw address-only deposits are irreversible at the protocol layer once allocated.

RoyaltyRail deliberately does not add an admin refund/backdoor because that authority could become a custody/seizure primitive.

Studio/API must provide strong network/mint/version/address confirmation and recommend a test transfer for unfamiliar large payers.

Direct `fund_and_allocate` is preferred for programmable integrations because intent/reference/nonce are explicit.

## 15. Agreement-hash security

Agreement hash binds:

- deployment ID;
- program ID;
- RevenuePool address;
- version + predecessor version;
- settlement mint/token program;
- pool kind/basis/metadata hash;
- terms hash;
- canonical participant authority/share vector.

Payout routing/accounting state is excluded intentionally. Rich creative roles/credits remain protected through the manifest's `terms_hash`, not duplicated as a singular protocol field.

Encoding uses versioned domain separator, fixed-width binary values, little-endian integers, canonical participant order and SHA-256. No JSON/map serialization is used for the on-chain economic hash.

Rust/TypeScript fixed vectors must match exactly.

## 16. Human-readable terms integrity

`terms_hash` anchors the Agreement Manifest.

Studio/SDK must:

1. validate manifest schema;
2. canonicalize using the specified JCS canonicalization;
3. compute `terms_hash`;
4. verify manifest participant authorities/shares against proposed on-chain fields;
5. compute/verify agreement hash;
6. only then request participant signature.

A compromised hosted frontend must not be able to show one deal while approving another without a conforming independent client detecting the mismatch.

## 17. Allocation-commitment security

Allocation commitment binds deployment ID, agreement address, post-increment allocation sequence, allocation mode, gross amount, reconciliation reference, and canonical participant authority/allocation vector.

Payout wallet is excluded because delivery may legitimately rotate after allocation.

## 18. Claim security

`claim_participant(index)` verifies exact AgreementVersion PDA, valid status, claims unpaused, valid index, positive claimable balance, exact Royalty Inbox, exact canonical ATA of the participant's current payout wallet, configured mint/token program, and sufficient inbox balance.

Claim caller supplies neither destination economics nor arbitrary payout amount. Vault PDA signs transfer.

## 19. Payout rotation security

Requires exact participant authority signer. Reject default address, no-op update, Cancelled agreement, or attempt to mutate another participant.

Every success increments `payout_revision` and emits an auditable event.

High-value users should use recoverable/multisig/smart-wallet participant authorities rather than hot-key-only identities.

## 20. Lost/compromised authority tradeoff

If a participant loses the authority required for amendments, RoyaltyRail preserves their current economics rather than giving manager/admin a bypass.

V1 has no manager-controlled participant recovery. Future recovery/assignment policy must be explicitly agreed in advance and separately threat-modeled.

If participant authority itself is compromised, the attacker may exercise powers that authority legitimately has; protocol cannot distinguish attacker from key holder.

## 21. Manager boundary

Manager may manage metadata/proposals but cannot activate around approvals, bypass predecessor consent, change payout wallets, withdraw inbox funds, or rewrite allocations/claims.

Management transfer is two-step propose/accept.

## 22. Guardian / governance boundary

Guardian may only set pause domains false -> true. Governance may pause/unpause and rotate guardian. Neither moves funds or changes participant economics.

Compromised guardian can cause temporary DoS; this operational trust must be disclosed and monitored.

## 23. Upgrade-authority threat

Upgradeable program authority can replace bytecode and bypass application-level guarantees.

The upgrade authority also authorizes the one-time ProtocolConfig initialization: `initialize_config` requires its co-signature, checked against this program's ProgramData. Initialization fixes permanent governance and the settlement mint. This closes the first-caller race in which anyone could initialize a freshly deployed program and claim governance. It also means the initial governance choice sits inside the upgrade-authority trust boundary. The local-validator adversarial matrix proves that front-running attempts are rejected (`CFG-04` to `CFG-08`).

Before meaningful mainnet value: no single hot-wallet upgrade authority, hardened multisig/governance, normal upgrade delay/timelock, ProgramData monitoring, reproducible/verifiable builds, emergency process, and long-term immutability criterion.

Do not market “non-custodial/no admin withdrawal” without disclosing current upgradeability status.

## 24. Account substitution checks

Every caller-provided account is constrained:

- Config: exact config PDA/schema;
- Work/Pool/Agreement: exact PDA + parent relationships + schema/status;
- Vault: exact PDA;
- Inbox: exact ATA(vault, mint, token program);
- Payer source: configured mint/program + signer authority;
- Claim destination: exact ATA(current payout wallet, mint, token program).

Never trust array position or caller label alone.

## 25. Arithmetic

- no floats;
- checked add/sub/mul/div;
- checked narrowing;
- current SPL amounts `u64`;
- lifetime accounting `u128`;
- no wrapping sequence/version/revision/nonces;
- invariant failure aborts transaction.

Rust must match canonical TypeScript allocation vectors/property tests.

## 26. Replay / idempotency

- Proposed approval: already-approved bit fails.
- Supersession approval: already-approved predecessor bit fails.
- Direct funding: expected direct nonce consumed exactly once; SDK refreshes/retries nonce conflicts safely.
- Inbox allocation: does not consume direct nonce; amount derives from current vault state.
- Claims: full current claim updates cumulative claimed; immediate repeat with zero claimable fails.
- Business payment idempotency: `payment_reference` is reconciliation metadata, not an on-chain duplicate set. API/SDK resolves uncertain transaction status before using a new nonce.

## 27. 16-participant bitmap edge

For participant count 16:

```text
required_mask = u16::MAX
```

Never evaluate `1u16 << 16`. Test proposed approval and predecessor supersession masks. One participant uses mask `0b1`.

## 28. Privacy

V1 is public-chain infrastructure. Never place sensitive PII on-chain.

Percentages, participant authorities, allocation/claim state and token flows are publicly observable. Dedicated wallets reduce casual linkage only; they are not cryptographic privacy.

Confidential splits require a different future architecture.

## 29. Negative statements / chargebacks

V1 never creates negative allocation and never confiscates already-claimed tokens.

External royalty corrections, returns and chargebacks must be netted before new distributable funds enter RoyaltyRail or resolved commercially outside v1.

## 30. Rights disputes / incomplete shares

V1 only activates resolved executable payment instructions totaling 100,000,000 share units. It does not decide disputed, under-claimed, over-claimed or unknown music rights.

A future suspense/dispute layer may support these conditions; adding admin discretion to v1 is not an acceptable shortcut.

## 31. Transaction/compute compatibility

Benchmark maximum participant paths before Anchor merge. Do not require newest transaction format unless needed.

If Solana v1 transactions are used, SDK must explicitly configure v1 message resources because their resource configuration differs from legacy/v0 transactions.

## 32. Data availability

Hash integrity is not content availability. Before beta, exact Agreement Manifest/evidence package must be exportable and retrievable without dependence on one hosted RoyaltyRail database.

## 33. Pre-mainnet gate

Production royalties remain forbidden until Anchor unit/integration tests, local-validator adversarial suite, randomized state-machine/interleaving tests, TypeScript/Rust allocation parity, agreement/allocation hash parity, 1–16 participant tests, predecessor-consent tests, payout-rotation tests, inbox solvency/claim-isolation tests, direct-vs-inbox nonce separation tests, account-substitution tests, max-size/compute/transaction benchmarks, dependency/toolchain pinning, reproducible/verifiable builds, every governance/guardian/upgrade and operational-risk gate listed below, monitoring/incident runbook, independent smart-contract audit, payments/fintech legal review, entertainment/royalty workflow legal review, and explicit mainnet sign-off are complete.

### Governance, guardian, upgrade, and operational-risk gates

Each item closes one of the unresolved risks in [`DEPLOYMENT_DEVNET_V1.md`](DEPLOYMENT_DEVNET_V1.md) ("Unresolved risks", items 1–10). All must be complete, or explicitly accepted in the mainnet sign-off with written rationale. None replaces another gate.

- [ ] **(1) Token freeze authority.** The behavior of the settlement mint's freeze authority (inbox freeze, payout-ATA freeze) is exercised on a validator, and integrators disclose it. A frozen payout ATA blocks only that participant.
- [ ] **(2) Deposits to non-settleable agreements.** SDK and integrations refuse to deposit to the inbox of an agreement that is not Active or Superseded. Deposits to a Proposed agreement that later activates are tested on-chain. The permanent lock of deposits to cancelled or rejected agreements is publicly disclosed.
- [ ] **(3) Compute headroom.** Allocation and claim compute is benchmarked at 16 participants for the exact mainnet candidate build, on the target runtime. Production clients request an explicit compute budget. Benchmarks are repeated for every program change.
- [ ] **(4) Upgrade authority.** The upgrade authority is a hardened multisig with an upgrade timelock and ProgramData monitoring (§23), and never a single hot wallet. The long-term immutability criterion is documented.
- [ ] **(5) Governance permanence.** Governance is an M-of-N multisig, and a recovery or rotation design is implemented and audited, or its absence is explicitly accepted (design options: `docs/GOVERNANCE_RECOVERY_V1.md`, proposed in PR #18). A guardian-pause runbook requires that governance be reachable to unpause.
- [ ] **(6) Key custody.** A fresh, owner-custodied mainnet identity is generated and used only on owner-controlled hardware, with backups verified by re-entry. No key, including any devnet key, has ever been in an AI-agent or CI environment.
- [ ] **(7) Dependency code beside keys.** Signing is isolated from third-party dependency code: a hardware or external signer, or a minimal audited signing path. No npm package runs in a process that holds a deployer, upgrade-authority, or governance key.
- [ ] **(8) Build verification.** The deployed artifact is a `solana-verify` verifiable build from a digest-pinned container, reproduced independently outside the CI container.
- [ ] **(9) Pre-deployment window.** The program keypair is owner-custodied from generation until deployment, and the time between identity commit and deployment is minimized and recorded.
- [ ] **(10) Durable evidence.** Mainnet deployment evidence (signatures, hashes, verifier output) is recorded in the repository and in a durable public location independent of any single RPC provider.

Green CI is not mainnet readiness.
