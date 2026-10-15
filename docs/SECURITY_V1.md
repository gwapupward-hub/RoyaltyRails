# RoyaltyRail Security Model v1

Status: Phase 2 hardened freeze candidate  
Date: 2026-10-15

## 1. Security objective

Once a valid agreement version is approved and activated:

> Revenue allocated to that version can only become claimable according to the exact approved economic terms, and claimable revenue can only be delivered to payout routing controlled by the corresponding participant authority.

RoyaltyRail does not guarantee that the legal/business terms entered by users are correct. It guarantees deterministic execution of the approved configuration.

## 2. Trusted for v1 correctness

- Solana runtime transaction atomicity/account locking;
- deployed RoyaltyRail bytecode;
- original SPL Token Program;
- configured native USDC mint;
- PDA derivation;
- canonical TypeScript/Rust allocation algorithm parity;
- participant signatures for proposed economic terms and predecessor supersession consent.

## 3. Explicitly not trusted

- RoyaltyRail Studio/API/indexer;
- RPC providers;
- agreement proposer or manager;
- direct payer;
- allocation triggerer;
- claim triggerer;
- guardian/governance authority;
- external metadata storage;
- email/SMS invite infrastructure;
- caller-supplied account ordering/labels;
- payment references as proof of uniqueness.

Security-critical facts must be re-derived or verified on-chain.

## 4. Primary economic invariants

### S-001 Share conservation

```text
sum(shares) == 10_000 BPS
```

### S-002 Allocation conservation

```text
sum(current allocations) == newly allocated amount
```

### S-003 Lifetime allocation conservation

```text
sum(participant.cumulative_allocated) == agreement.cumulative_gross
```

### S-004 Claim bounds

For every participant:

```text
0 <= cumulative_claimed <= cumulative_allocated
```

### S-005 Vault solvency

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

### S-006 No negative economic delta

The allocation algorithm never requires a participant clawback.

### S-007 Bounded proportional error

Each participant's lifetime allocation deviation remains strictly below one settlement-asset base unit.

## 5. Replacement-consent invariant

A manager must never be able to remove or reduce an existing participant simply by omitting them from a replacement proposal.

For replacement activation:

- all participants in the new proposal approve the new agreement; and
- all participants in the current Active predecessor approve supersession by that exact new agreement hash.

This remains true even when a predecessor participant is absent from the replacement.

Required adversarial test:

```text
v1 = Alice 60 / Bob 40
manager proposes v2 = Alice 100
Alice approves v2
activation MUST fail until Bob explicitly consents to supersession
```

## 6. Economic terms vs payout routing

Participant authority, BPS share, and role are economic agreement fields.

Payout wallet is participant-controlled operational routing and is excluded from agreement hash.

Only the participant authority may update that participant's payout wallet.

A manager, guardian, governance authority, claim triggerer, or another participant cannot redirect it.

Required test:

```text
participant B signs update_payout_wallet(B2)
B share remains identical
agreement hash remains identical
A payout wallet remains identical
future B claims use canonical ATA(B2)
```

## 7. Pull-claim liveness model

V1 deliberately separates allocation from token delivery.

One unhealthy recipient destination must not block another participant from receiving funds.

A claim transaction references one participant index and one canonical destination ATA. A failure for that claim rolls back only that transaction.

This protects against:

- missing recipient ATA;
- frozen recipient token account;
- malformed recipient account input;
- recipient wallet rotation;
- one recipient being temporarily operationally unavailable.

Studio/keepers may automatically push claims so users do not need to manually withdraw.

## 8. USDC freeze-authority limitation

The original SPL Token Program supports token-account freezing when the mint retains freeze authority. A frozen token account cannot receive or transfer tokens until thawed.

RoyaltyRail mitigates recipient freeze risk by allowing participant-controlled payout-wallet rotation and per-participant claims.

RoyaltyRail cannot cryptographically eliminate issuer-level controls over native USDC itself. A frozen Royalty Inbox would be a settlement-asset/issuer-level failure outside RoyaltyRail's authority.

This trust dependency must be disclosed in production risk documentation.

## 9. Asset boundary

V1 accepts exactly one configured settlement mint and original SPL Token Program per deployment.

Reject:

- lookalike USDC;
- arbitrary caller mints;
- Token-2022 accounts;
- source/destination token accounts for another mint;
- token program IDs other than configured original SPL Token Program.

TransferChecked or equivalent decimal-verified transfer semantics should be preferred in implementation.

## 10. Direct payer source accounts

Direct funding source does not need to be an ATA.

Required checks:

- source account owned by configured Token Program;
- source account mint equals configured settlement mint;
- source token authority equals payer signer propagated into RoyaltyRail;
- amount positive and sufficient;
- delegated authority is not supported unless separately specified/tested.

This allows treasuries/smart-wallets/programmatic integrations without weakening token-authority validation.

## 11. Royalty Inbox authority

Vault authority PDA:

```text
[b"vault", agreement_version]
```

Royalty Inbox must equal canonical ATA for vault authority + configured mint + configured Token Program.

No v1 instruction equivalent to these may exist:

```text
admin_withdraw
rescue_to_arbitrary_destination
override_claim_destination
force_custom_allocation
edit_participant_share
```

Program CPI inventory must be audited to prove this, not merely rely on documentation.

## 12. Inbox accounting attacks

External parties may send configured USDC to the public Royalty Inbox at any time.

Attack attempts include:

- dust deposits;
- front-running allocation with a deposit;
- racing a claim and allocation;
- repeated micro-deposits;
- depositing during direct funding.

The vault-solvency equation makes these safe:

```text
unallocated = inbox_balance - allocated_unclaimed
```

Claims decrease both terms equally. External deposits only increase balance. `allocate_inbox` allocates only the positive difference.

Concurrency tests must fuzz arbitrary sequences of:

```text
external_deposit
fund_and_allocate
allocate_inbox
claim_participant
```

while preserving the solvency invariant.

## 13. Agreement-hash security

Agreement hash binds:

- deployment ID;
- program ID;
- RevenuePool address;
- version + predecessor version;
- settlement mint/token program;
- pool kind/basis/metadata hash;
- terms hash;
- canonical participant authority/share/role vector.

It intentionally excludes payout routing/accounting state.

Encoding rules:

- versioned domain separator;
- fixed-width binary fields;
- little-endian integers;
- canonical participant order;
- SHA-256;
- no JSON/map serialization for the on-chain economic hash.

Rust and TypeScript must pass identical fixed vectors.

## 14. Deployment-domain separation

`deployment_id` is non-zero, immutable, and included in agreement/allocation commitments.

This prevents ambiguous commitments across independent deployments or clusters reusing similar identifiers/test data.

Initialization must reject an all-zero deployment ID.

## 15. Allocation-commitment security

Allocation commitment binds:

- deployment ID;
- agreement address;
- post-increment allocation sequence;
- allocation mode;
- gross amount;
- 32-byte reconciliation reference;
- canonical participant authority/allocation vector.

It does not bind payout wallet because allocation and delivery are separate security domains.

## 16. Payout-claim security

`claim_participant(index)` must validate:

- exact AgreementVersion PDA;
- valid status;
- claims not paused;
- index in bounds;
- claimable amount > 0;
- canonical Royalty Inbox;
- exact canonical ATA of participant's **current** payout wallet;
- configured mint/token program;
- claimable amount fits u64;
- inbox token balance sufficient.

Only program-derived vault authority signs outgoing transfer.

Claim triggerer never chooses destination or amount.

## 17. Payout-wallet rotation security

`update_payout_wallet` requires exact participant authority signer.

Must reject:

- default/zero wallet;
- no-op update;
- cancelled agreement;
- caller controlling another participant's index.

Each successful update increments `payout_revision` and emits previous/new routing metadata sufficient for audit indexing.

For high-value users, Studio should recommend approval authorities backed by smart-wallet/multisig/social-recovery controls rather than a single hot key.

## 18. Participant-key loss tradeoff

If a participant loses the authority needed to approve future amendments, RoyaltyRail must prefer protecting their existing economics over allowing a manager to bypass them.

Therefore v1 does not include a manager-controlled participant-recovery primitive.

Users requiring recoverability should use an approval authority with appropriate key-recovery/multisig policy.

Any future participant-authority recovery system requires a separate economic-consent threat model.

## 19. Manager-authority boundary

Manager controls descriptive metadata and proposal creation only.

Manager cannot:

- activate without participant consent;
- bypass predecessor consent;
- redirect payout wallets;
- claim participant funds elsewhere;
- withdraw inbox funds;
- alter existing allocation state.

Work/Pool manager transfer should use two-step propose/accept to reduce mistaken-address handoff.

## 20. Guardian/governance separation

Production authority model:

### Guardian

May only set pause domains from false -> true.

### Governance

May pause/unpause and rotate guardian within v1-configured controls.

Neither may move funds or alter participant economics.

Production governance should be hardened multisig/governance rather than a hot key.

## 21. Upgrade-authority threat

An upgradeable program can replace application code and bypass application-level invariants.

Before meaningful mainnet value:

- upgrade authority must not be one hot wallet;
- use hardened multisig/governance;
- define normal upgrade delay/timelock policy;
- publish/monitor ProgramData changes;
- use verifiable builds;
- document emergency upgrade process;
- define long-term criterion for making a mature audited deployment immutable.

The product must never market application-level no-custody guarantees without also disclosing upgradeability status.

## 22. Account substitution checks

Every caller-supplied account must be constrained.

### Config
- exact config PDA;
- RoyaltyRail-owned;
- expected schema.

### Work/Pool/Agreement
- exact PDA seeds;
- expected stored parent relationship;
- expected schema/status.

### Royalty Inbox
- exact ATA for derived vault authority + configured mint/token program.

### Direct payer source
- configured mint;
- configured token program;
- token authority == payer signer.

### Claim destination
- exact ATA for stored current payout wallet + configured mint/token program.

No account is trusted because of array position alone.

## 23. Arithmetic security

- integer-only math;
- no unchecked add/sub/mul/div;
- no unchecked narrowing;
- allocation input u64;
- cumulative gross/allocation/claim state u128;
- actual SPL transfers checked to u64;
- conservation and residual bounds asserted;
- invariant failure aborts transaction.

Rust implementation must match TypeScript vectors and randomized property tests.

## 24. Replay/idempotency

### Approval
Already-approved bit fails.

### Supersession consent
Already-approved predecessor bit fails.

### Direct funding
Expected agreement-wide nonce is consumed exactly once.

This is conservative and can create contention among concurrent direct funders. SDK must automatically refresh/retry nonce-conflict transactions.

`payment_reference` is reconciliation metadata, **not** replay protection.

Payer-scoped nonce/idempotency receipts are deferred pending scale benchmarks.

### Claims
A successful full claim updates cumulative claimed. Immediate repeat against zero claimable fails.

## 25. Sequence overflow

All version, revision, nonce, and sequence increments are checked.

Overflow causes failure. No wrapping allowed.

## 26. 16-participant approval-mask edge case

For 16 participants:

```text
required_mask = u16::MAX
```

Do not evaluate `1u16 << 16`.

Dedicated tests required for both proposed approval and predecessor supersession masks.

## 27. Pause threat model

Pause domains:

```text
agreements
allocations
claims
```

Pauses stop execution; they do not transfer custody or modify balances/economics.

A compromised guardian can cause temporary DoS until governance rotates guardian/unpauses. This operational trust must be documented.

Consider an operational maximum emergency-pause policy/timelock before mainnet, even if enforcement remains governance-layer rather than program-layer.

## 28. Denial-of-service scenarios

Test:

- frozen recipient ATA;
- closed/missing recipient ATA;
- payout rotation to fresh wallet;
- malformed claim destination;
- Royalty Inbox frozen by issuer (documented external dependency);
- max 16 participants;
- claim amount > u64 due cumulative state (must split/handle design before impossible state is reachable);
- compute limit exhaustion;
- transaction format compatibility;
- manager key loss;
- participant key loss;
- guardian pause;
- RPC/indexer outage;
- RoyaltyRail backend outage.

The protocol must remain directly callable without RoyaltyRail infrastructure.

## 29. Transaction-format/compute compatibility

Do not require the newest transaction format unless benchmark evidence shows it is necessary.

Phase 3 must benchmark legacy/v0/v1 construction where relevant and max-participant account/compute usage.

If v1-format transactions are used, SDK must explicitly configure required resource limits because v1 transaction resource defaults differ from legacy/v0 behavior.

## 30. Data privacy

On-chain V1 data is public.

Do not store:

- tax IDs;
- government IDs;
- bank accounts;
- home addresses;
- private contract text;
- private email/phone data.

Percentages and participant authorities remain publicly visible. Dedicated wallets are not cryptographic privacy.

Private/confidential splits require a future distinct design.

## 31. Human-readable approval risk

A cryptographic hash is not sufficient UX by itself.

Studio must show a deterministic human-readable agreement summary before signature and retain/export an evidence package linking that representation to the approved hash.

Do not label protocol approval as a universally legally sufficient signature without jurisdiction-specific legal review.

## 32. Terms-manifest availability

Before beta, define a versioned Agreement Manifest schema and redundant/content-addressed retention strategy so users can independently recover the human-readable terms corresponding to `terms_hash` even if RoyaltyRail's hosted frontend/indexer disappears.

## 33. Dependency/CPI policy

Expected external programs only:

- System Program when needed for state creation;
- Associated Token Program for canonical inbox/recipient ATA creation helpers;
- original SPL Token Program for USDC transfers.

No caller-selected arbitrary CPI targets.

Original SPL Token Program avoids Token-2022 transfer-hook callback surfaces in v1.

## 34. Reserved account bytes

Reserved padding must initialize to zero and remain inaccessible to ordinary v1 instructions.

A future schema may interpret it only through reviewed migration/version logic.

Reserved bytes cannot become a backdoor for changing existing economics.

## 35. Pre-mainnet gate

Production royalties remain forbidden until all are complete:

- Anchor unit/integration tests;
- local-validator adversarial suite;
- randomized state-machine/fuzz tests;
- TypeScript/Rust allocation parity;
- agreement/allocation hash parity;
- predecessor-consent tests;
- payout-rotation tests;
- claim-isolation tests;
- inbox solvency/interleaving tests;
- max-participant compute/transaction benchmarks;
- dependency/toolchain pinning;
- reproducible/verifiable builds;
- production governance/guardian/upgrade policy;
- monitoring/alerting;
- incident-response runbook;
- independent smart-contract audit;
- payments/fintech legal architecture review;
- entertainment/royalty workflow legal review;
- explicit mainnet checklist/sign-off.

Green CI is not mainnet readiness.
