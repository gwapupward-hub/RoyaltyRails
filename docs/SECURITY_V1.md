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

### S-001 Shares

```text
participant_count in 1..=16
sum(shares) == 10_000 BPS
all shares > 0
```

### S-002 Allocation conservation

```text
sum(current allocations) == newly allocated amount
```

### S-003 Lifetime allocation conservation

```text
sum(cumulative_allocated) == cumulative_gross
```

### S-004 Claim bounds

```text
0 <= cumulative_claimed_i <= cumulative_allocated_i
```

### S-005 Inbox solvency

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

### S-006 No negative allocation

Canonical math never requires clawback allocation.

### S-007 Bounded rounding error

Every participant's lifetime proportional allocation deviation stays strictly below one settlement-asset base unit.

## 4. Pure allocation boundary

The TypeScript/Rust allocation engine contains only economic math:

```text
agreement shares
cumulative gross/allocation state
new amount
```

It does not contain:

- direct funding nonce;
- wallets/token accounts;
- claims;
- Solana CPI logic;
- payment references.

This is critical because `fund_and_allocate` and `allocate_inbox` must invoke identical percentage math while having different replay semantics.

Direct nonce is checked/incremented only by the direct funding protocol instruction. Inbox allocation never consumes it.

## 5. Replacement-consent invariant

A manager cannot remove/reduce an existing participant by omitting them from the proposed replacement.

Replacement activation requires:

- unanimous approval by proposed participants; and
- unanimous supersession consent from current predecessor participants to the exact new agreement hash.

Required adversarial test:

```text
v1 = Alice 60 / Bob 40
proposed v2 = Alice 100
Alice approves proposed v2
activation MUST fail until Bob approves supersession
```

A one-recipient successor is valid once all required old/new consent exists.

## 6. Economic identity vs payout routing

Economic hash binds:

```text
participant authority
share BPS
role code
```

It does not bind current payout wallet.

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

Allocation and claims are separate.

A missing/frozen/unusable recipient destination must not block another participant.

Each claim references one participant and one canonical current payout ATA. Failed claim transaction changes no state.

Studio/third-party keepers may automatically submit claims, but correctness/liveness does not require RoyaltyRail's keeper.

## 8. Claim amount width proof

SPL token-account amount is `u64`.

From solvency:

```text
sum(all current claimable) <= inbox_balance <= u64::MAX
```

Therefore:

```text
claimable_i <= u64::MAX
```

for every participant in every valid solvent state.

Lifetime cumulative values remain `u128`, but a current claim cannot exceed the token transfer amount type. No claim chunking is required.

Phase 3 must include an invariant test proving this relationship rather than relying only on prose.

## 9. USDC issuer controls

An original SPL Token account can be frozen when its mint retains freeze authority. A frozen account cannot receive, transfer or burn until thawed.

RoyaltyRail mitigates recipient-account freeze by independent claims + participant payout rotation.

RoyaltyRail cannot eliminate issuer-level controls over native USDC. If the Royalty Inbox itself is frozen by the issuer, RoyaltyRail cannot transfer those tokens. This is an external settlement-asset trust dependency and must be disclosed.

## 10. Asset boundary

One configured settlement mint and original SPL Token Program per deployment.

Reject:

- lookalike USDC;
- arbitrary caller mints;
- Token-2022 accounts;
- wrong-mint source/destination accounts;
- wrong Token Program;
- uninitialized mint;
- unexpected decimals for configured USDC deployment.

Implementation should use checked transfer semantics with explicit mint decimals.

## 11. Direct payer source

Direct funding source need not be ATA.

Must verify:

- owned by configured Token Program;
- mint equals configured settlement mint;
- token authority equals propagated payer signer;
- positive sufficient amount.

Delegated SPL token authority/multisig source support is not v1 unless separately specified and tested.

This still allows many smart-wallet/programmatic flows when their PDA authority is propagated as signer via CPI.

## 12. Royalty Inbox authority

Vault PDA:

```text
[b"vault", agreement_version]
```

Royalty Inbox is exact canonical ATA for vault PDA + configured USDC mint + configured Token Program.

No v1 equivalent of:

```text
admin_withdraw
rescue_to_arbitrary_destination
override_claim_destination
force_custom_allocation
edit_share
```

may exist.

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

including dust/micro-deposits and races.

The invariant:

```text
unallocated = inbox_balance - allocated_unclaimed
```

must hold after every successful transition.

Micro-deposit partitioning may affect which participant gets an indivisible micro-USDC unit at an intermediate point, but lifetime deviation remains bounded below one base unit.

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
- canonical participant authority/share/role vector.

Payout routing/accounting state is excluded intentionally.

Encoding:

- versioned domain separator;
- fixed-width binary values;
- little-endian integers;
- canonical participant order;
- SHA-256;
- no JSON/map serialization for on-chain economic hash.

Rust/TypeScript fixed vectors must match exactly.

## 16. Human-readable terms integrity

`terms_hash` anchors the Agreement Manifest.

Studio/SDK must:

1. validate manifest schema;
2. canonicalize using the specified manifest canonicalization;
3. compute `terms_hash`;
4. verify manifest economic participant data against proposed on-chain fields;
5. compute/verify agreement hash;
6. only then request participant signature.

A compromised hosted frontend must not be able to show one deal while approving another without a conforming independent client detecting the mismatch.

## 17. Allocation-commitment security

Allocation commitment binds:

- deployment ID;
- agreement address;
- post-increment allocation sequence;
- allocation mode;
- gross amount;
- reconciliation reference;
- canonical participant authority/allocation vector.

Payout wallet is excluded because delivery may legitimately rotate after economic allocation.

## 18. Claim security

`claim_participant(index)` verifies:

- exact AgreementVersion PDA;
- valid status;
- claims unpaused;
- valid index;
- positive claimable balance;
- exact Royalty Inbox;
- exact canonical ATA of participant's current payout wallet;
- configured mint/token program;
- inbox has sufficient balance.

Claim caller supplies neither destination economics nor arbitrary payout amount.

Vault PDA signs transfer.

## 19. Payout rotation security

Requires exact participant authority signer.

Reject:

- default address;
- no-op update;
- Cancelled agreement;
- attempt to mutate another participant.

Every success increments `payout_revision` and emits auditable event.

High-value users should use recoverable/multisig/smart-wallet participant authorities rather than hot-key-only identities.

## 20. Lost/compromised authority tradeoff

If a participant loses the authority required for amendments, RoyaltyRail prefers preserving that participant's current economics over giving manager/admin a bypass.

V1 has no manager-controlled participant recovery.

Future recovery/assignment policy must be explicitly agreed in advance and separately threat-modeled.

If participant authority itself is compromised, attacker may use powers that authority legitimately has (e.g. payout rotation/consent). RoyaltyRail cannot distinguish attacker from key holder.

## 21. Manager boundary

Manager may manage metadata/proposals within allowed flows.

Manager cannot:

- activate around approvals;
- bypass predecessor consent;
- change payout wallets;
- withdraw inbox funds;
- rewrite allocations/claims.

Management transfer is two-step propose/accept.

## 22. Guardian / governance boundary

Guardian may only set pause domains false -> true.

Governance may pause/unpause and rotate guardian.

Neither moves funds or changes participant economics.

Compromised guardian can cause temporary DoS; this operational trust must be disclosed and monitored.

## 23. Upgrade-authority threat

Upgradeable program authority can replace bytecode and bypass application-level guarantees.

Before meaningful mainnet value:

- no single hot-wallet upgrade authority;
- hardened multisig/governance;
- normal upgrade delay/timelock policy;
- ProgramData monitoring;
- reproducible/verifiable builds;
- emergency process;
- long-term immutability criterion.

Do not market “non-custodial/no admin withdrawal” without disclosing current upgradeability status.

## 24. Account substitution checks

Every caller-provided account is constrained.

- Config: exact config PDA/schema.
- Work/Pool/Agreement: exact PDA + parent relationships + schema/status.
- Vault: exact PDA.
- Inbox: exact ATA(vault, mint, token program).
- Payer source: configured mint/program + signer authority.
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

### Proposed approval
Already-approved bit fails.

### Supersession approval
Already-approved predecessor bit fails.

### Direct funding
Expected direct nonce consumed exactly once. Global per-agreement nonce is intentionally conservative and may serialize concurrent direct funders. SDK must refresh/retry nonce conflicts safely.

### Inbox allocation
Does not use/consume direct nonce. Its amount is derived from current vault state.

### Claims
Full current claim updates cumulative claimed; immediate repeat with zero claimable fails.

### Business payment idempotency
`payment_reference` is reconciliation metadata, not an on-chain duplicate set. SDK/API must resolve uncertain transaction status before using a new nonce. Future optional receipt PDA may address enterprise demand.

## 27. 16-participant bitmap edge

For participant count 16:

```text
required_mask = u16::MAX
```

Never evaluate `1u16 << 16`.

Test both proposed approval and predecessor supersession masks.

## 28. Privacy

V1 is public-chain infrastructure.

Never place sensitive PII on-chain.

Percentages, participant authorities, allocation/claim state and token flows are publicly observable. Dedicated wallets reduce casual linkage only; they are not cryptographic privacy.

Confidential splits require a different future architecture.

## 29. Negative statements / chargebacks

V1 never creates negative allocation and never confiscates already-claimed tokens.

External royalty corrections, returns and chargebacks must be netted before new distributable funds enter RoyaltyRail or resolved commercially outside v1.

Do not misrepresent v1 as a full royalty accounting/recoupment engine.

## 30. Rights disputes / incomplete shares

V1 only activates resolved executable payment instructions totaling 10,000 BPS.

It does not decide disputed, under-claimed, over-claimed or unknown music rights.

A future suspense/dispute layer may support these conditions; adding admin discretion to v1 is not an acceptable shortcut.

## 31. Transaction/compute compatibility

Benchmark maximum participant paths before Anchor merge.

Do not require newest transaction format unless needed.

If Solana v1 transactions are used, SDK must explicitly configure v1 message resources because their resource configuration differs from legacy/v0 transactions.

## 32. Data availability

Hash integrity is not content availability.

Before beta, exact Agreement Manifest/evidence package must be exportable and retrievable without dependence on a single hosted RoyaltyRail database.

## 33. Pre-mainnet gate

Production royalties remain forbidden until:

- Anchor unit/integration tests;
- local-validator adversarial suite;
- randomized state-machine/interleaving tests;
- TypeScript/Rust allocation parity;
- agreement/allocation commitment parity;
- 1–16 participant tests;
- predecessor-consent tests;
- payout-rotation tests;
- inbox solvency + claim-isolation tests;
- direct-vs-inbox nonce-separation tests;
- account substitution tests;
- max-size/compute/transaction benchmarks;
- dependency/toolchain pinning;
- reproducible/verifiable builds;
- hardened governance/guardian/upgrade policy;
- monitoring + incident runbook;
- independent smart-contract audit;
- payments/fintech legal architecture review;
- entertainment/royalty workflow legal review;
- explicit mainnet sign-off.

Green CI is not mainnet readiness.
