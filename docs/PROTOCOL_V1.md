# RoyaltyRail Protocol Specification v1

Status: Phase 2 specification freeze candidate  
Product: RoyaltyRail  
Network: Solana  
Settlement asset: one deployment-configured native USDC mint  
Date: 2026-10-14

> This document defines the on-chain behavior that the future Anchor implementation must reproduce. It is not deployed contract code.

## 1. Purpose

RoyaltyRail v1 turns unanimously approved percentage-based revenue agreements into deterministic USDC settlement instructions.

The program does not determine legal copyright ownership, royalty rates, or contractual entitlement. It enforces a settlement configuration that the relevant participants explicitly approved.

The economic source of truth remains the merged TypeScript reference engine in `packages/royaltyrail-accounting`.

## 2. V1 constraints

- one Solana program deployment per environment;
- one configured settlement mint per deployment;
- mainnet deployment must use the intended native Circle-issued Solana USDC mint;
- original SPL Token Program only in v1;
- 2 to 16 participants per agreement version;
- integer basis points only;
- shares must total exactly 10,000 BPS;
- all participant authorities must be unique;
- participant ordering is canonical and deterministic;
- unanimous approval is required;
- active agreement versions are immutable;
- changes create new versions;
- no admin withdrawal instruction exists;
- protocol settlement fee is zero in v1;
- direct settlement and Royalty Inbox settlement are both supported;
- no recoupment, waterfalls, fiat custody, arbitrary SPL assets, tokenized royalties, lending, or secondary markets.

## 3. Terminology

### Work

A descriptive root for a creative work or other revenue-generating object. It does not itself control money.

### Revenue Pool

Defines what class of revenue an agreement governs. A pool is immutable after creation in v1.

### Agreement Version

An immutable economic configuration containing participants, payout wallets, BPS shares, approval state, settlement accounting, and its canonical agreement hash.

### Participant Authority

The Solana public key that must sign approval for one participant line.

### Payout Wallet

The Solana public key whose canonical USDC Associated Token Account receives that participant's settlement.

### Royalty Inbox

The canonical USDC ATA owned by an agreement-version-specific PDA authority. External payers may deposit USDC directly into this address; anyone may later trigger a full deterministic flush.

## 4. Canonical participant ordering

Before proposal, participants MUST be sorted lexicographically by the 32 raw bytes of `participant_authority` in ascending order.

The program rejects a proposal whose participant array is not strictly sorted.

This rule serves three purposes:

1. duplicate participant authorities become trivial to reject;
2. canonical agreement hashing becomes stable across clients;
3. the accounting engine's deterministic rounding tie-break cannot be manipulated by proposer-supplied ordering.

A single participant authority may appear only once in one agreement version. If one person has multiple contractual roles in the same pool, v1 requires those economic shares to be combined into one participant line for settlement.

Duplicate payout wallets are permitted because multiple distinct parties may intentionally use a common custodian or treasury wallet. Approval authorities remain distinct.

## 5. Settlement basis

Every `RevenuePool` stores one semantic settlement basis:

- `OwnershipSplit`
- `RevenueParticipation`
- `PaymentDirection`

The basis describes why payments are being routed. It does not change percentage arithmetic in v1.

## 6. Revenue pool kinds

V1 defines:

- `MasterReceipts`
- `CompositionReceipts`
- `Custom`

The enum is descriptive. A `Custom` pool's exact economic meaning must be represented by the immutable pool metadata hash.

## 7. Account model

### 7.1 `ProtocolConfig`

PDA seeds:

```text
[b"config"]
```

Fields:

```text
schema_version: u16
bump: u8
admin_authority: Pubkey
settlement_mint: Pubkey
token_program: Pubkey
agreements_paused: bool
settlements_paused: bool
created_slot: u64
```

Rules:

- exactly one config exists per program deployment;
- `settlement_mint` is immutable after initialization;
- `token_program` is immutable after initialization;
- v1 requires the original SPL Token Program;
- mainnet initialization must use the approved native USDC mint;
- admin may only control pause state through v1 instructions;
- admin cannot change settlement terms, payout wallets, shares, agreement accounting, or withdraw user funds.

### 7.2 `Work`

PDA seeds:

```text
[b"work", authority, work_id]
```

Where `work_id` is exactly 32 bytes, normally a client-generated hash or random identifier.

Fields:

```text
schema_version: u16
bump: u8
authority: Pubkey
work_id: [u8; 32]
metadata_hash: [u8; 32]
metadata_version: u32
created_slot: u64
updated_slot: u64
```

Rules:

- `authority` is fixed in v1;
- work metadata is descriptive and may be updated by `authority`;
- updating `Work.metadata_hash` does not alter an existing pool or agreement hash;
- economic descriptions that must remain immutable belong in `RevenuePool` or `AgreementVersion` hashes, not mutable work metadata.

### 7.3 `RevenuePool`

PDA seeds:

```text
[b"pool", work, pool_id]
```

Where `pool_id` is exactly 32 bytes.

Fields:

```text
schema_version: u16
bump: u8
work: Pubkey
authority: Pubkey
pool_id: [u8; 32]
pool_kind: RevenuePoolKind
settlement_basis: SettlementBasis
metadata_hash: [u8; 32]
latest_version: u32
active_version: u32
pending_version: u32
created_slot: u64
```

Conventions:

```text
active_version = 0   => no active agreement yet
pending_version = 0  => no pending proposal
```

Rules:

- `authority` must equal the parent `Work.authority` at creation;
- v1 does not allow pool authority transfer;
- `pool_kind`, `settlement_basis`, and `metadata_hash` are immutable;
- at most one pending agreement version may exist per pool;
- version numbers are monotonically increasing and are never reused, including cancelled versions.

### 7.4 `Participant`

Serialized inside `AgreementVersion`:

```text
participant_authority: Pubkey
payout_wallet: Pubkey
share_bps: u16
role_code: u16
```

`role_code` is descriptive application metadata included in the agreement hash. It does not alter settlement arithmetic.

### 7.5 `AgreementVersion`

PDA seeds:

```text
[b"agreement", revenue_pool, version_u32_le]
```

Fields:

```text
schema_version: u16
bump: u8
revenue_pool: Pubkey
version: u32
status: AgreementStatus
settlement_mint: Pubkey
token_program: Pubkey
terms_hash: [u8; 32]
agreement_hash: [u8; 32]
participants: Vec<Participant>          // max 16
approval_bitmap: u16
cumulative_gross: u128
cumulative_paid: Vec<u128>              // same length/order as participants
direct_settlement_nonce: u64
settlement_sequence: u64
created_slot: u64
activated_slot: u64
superseded_slot: u64
```

Status enum:

```text
Proposed
Active
Superseded
Cancelled
```

Rules:

- `settlement_mint` and `token_program` are snapshotted from `ProtocolConfig` when proposed;
- participant length is 2..=16;
- all shares are non-zero;
- shares total exactly 10,000 BPS;
- participant authorities are strictly sorted and unique;
- `cumulative_paid.len == participants.len`;
- `sum(cumulative_paid) == cumulative_gross`;
- all cumulative accounting uses checked `u128` arithmetic;
- a single settlement amount and each SPL transfer use checked `u64` values;
- `Active` and `Superseded` agreement versions remain settleable;
- `Proposed` and `Cancelled` versions are not settleable;
- an activated agreement can never return to `Proposed` or `Cancelled`.

## 8. Royalty Inbox authority

No rent-bearing `VaultAuthority` state account is created.

For every agreement version, the program derives an authority PDA:

```text
[b"vault", agreement_version]
```

The Royalty Inbox is the canonical Associated Token Account for:

```text
owner = vault_authority_pda
mint  = agreement.settlement_mint
program = original SPL Token Program
```

The authority PDA has no private key. The RoyaltyRail program may sign Token Program CPIs for that PDA using the canonical bump.

The Royalty Inbox may be created permissionlessly by a payer through `initialize_inbox` once an agreement version is Active or Superseded.

## 9. Recipient token-account rule

Every settlement recipient account MUST be the canonical ATA derived from:

```text
owner = participant.payout_wallet
mint  = agreement.settlement_mint
program = agreement.token_program
```

The program rejects alternate token accounts even if their internal owner/mint fields appear valid.

Rationale: exact ATA validation removes destination ambiguity and materially reduces account-substitution risk.

Recipient ATAs are prepared outside settlement through an idempotent application/SDK flow. V1 settlement instructions do not create recipient token accounts.

## 10. Agreement hash

The agreement hash MUST be produced by deterministic binary encoding, not JSON text.

Domain separator:

```text
ROYALTYRAIL_AGREEMENT_V1
```

Conceptual preimage:

```text
domain_separator
program_id
revenue_pool_pubkey
version_u32_le
settlement_mint
token_program
pool_kind
settlement_basis
pool_metadata_hash
terms_hash
participant_count_u8
for each participant in canonical order:
    participant_authority
    payout_wallet
    share_bps_u16_le
    role_code_u16_le
```

Hash function:

```text
SHA-256
```

The Rust implementation and SDK MUST share canonical test vectors for agreement hashing before Gate 3 passes.

## 11. Approval model

`approval_bitmap` uses one bit per participant index.

For `n` participants, the required mask is:

```text
(1 << n) - 1
```

`approve_agreement(expected_agreement_hash)` requires:

- agreement status is `Proposed`;
- agreements are not paused;
- signer matches exactly one `participant_authority`;
- instruction-supplied `expected_agreement_hash` equals the stored hash;
- participant's bit is not already set.

The instruction then sets that participant's bit and emits `ParticipantApproved`.

A participant approves the exact on-chain agreement hash. Any economic edit requires a new version and new approvals.

## 12. Proposal lifecycle

### Initial version

1. pool authority calls `propose_agreement`;
2. pool must have `pending_version == 0`;
3. `new_version = latest_version + 1`;
4. proposal account is created;
5. `latest_version = new_version`;
6. `pending_version = new_version`;
7. participants approve;
8. anyone may call `activate_initial_agreement` after unanimous approval;
9. pool must have `active_version == 0`;
10. agreement becomes `Active`;
11. `pool.active_version = new_version`;
12. `pool.pending_version = 0`.

### Replacement version

1. pool authority calls `propose_agreement`;
2. participants approve;
3. anyone may call `activate_next_version` after unanimous approval;
4. caller must provide the exact current active version account;
5. prior active version becomes `Superseded`;
6. new proposal becomes `Active`;
7. pool active/pending pointers update atomically.

### Cancellation and rejection

`cancel_agreement` may be called by the pool authority while the version is `Proposed`.

`reject_agreement` may be called by any listed participant authority while the version is `Proposed`.

Both:

- mark the proposal `Cancelled`;
- clear `pool.pending_version` if it references that proposal;
- preserve the cancelled account and version number for auditability;
- never reuse the cancelled version number.

## 13. Settlement eligibility

Settlement is permitted only when:

```text
agreement.status in {Active, Superseded}
settlements_paused == false
agreement.settlement_mint == config.settlement_mint
agreement.token_program == config.token_program
```

Superseded versions remain settleable because delayed or historical royalties may legitimately belong to old terms.

The user interface MUST clearly distinguish Active from Superseded destinations to reduce accidental use of old terms.

## 14. Direct settlement

Instruction:

```text
settle_direct(amount: u64, expected_nonce: u64)
```

Required high-level accounts:

```text
config
agreement_version (mutable)
payer (signer)
payer_usdc_ata (mutable)
settlement_mint
token_program
recipient_atas[participant_count] (mutable, ordered)
```

Rules:

- payer token account must be the payer's canonical ATA for the configured mint;
- `amount > 0`;
- `expected_nonce == agreement.direct_settlement_nonce`;
- recipient ATAs are provided in exact participant order;
- every recipient ATA is validated against its stored payout wallet;
- the program runs the same bounded-error carry algorithm as the TypeScript reference engine;
- each computed payout must fit in `u64`;
- Token Program transfers are executed for non-zero payouts;
- state is advanced only as part of the same Solana transaction;
- if any transfer or check fails, the whole transaction rolls back;
- on success, `direct_settlement_nonce += 1`;
- on success, `settlement_sequence += 1`.

The protocol fee is zero; therefore:

```text
sum(recipient_payouts) == amount
```

## 15. Royalty Inbox settlement

Instruction:

```text
settle_inbox()
```

The instruction takes no caller-supplied settlement amount.

Required high-level accounts:

```text
config
agreement_version (mutable)
vault_authority_pda
royalty_inbox_ata (mutable)
settlement_mint
token_program
recipient_atas[participant_count] (mutable, ordered)
```

Rules:

- Royalty Inbox must equal the canonical ATA for the version-specific vault authority;
- amount is read from the inbox token account at instruction execution;
- amount must be greater than zero;
- the entire current inbox balance is settled;
- partial inbox settlement is not supported in v1;
- payouts use the same accounting engine as direct settlement;
- vault authority PDA signs outgoing Token Program transfers;
- successful execution leaves the inbox USDC amount at zero unless another instruction in the surrounding transaction later transfers new funds into it;
- `settlement_sequence += 1`;
- direct nonce is unchanged.

No signer-specific privilege is required to choose payout destinations or amounts. The transaction fee payer may be any party. The already-approved agreement determines every economic output.

## 16. Cumulative accounting

The merged TypeScript engine is normative for v1 arithmetic.

Per participant, the implementation carries an implicit signed rounding residual derived from:

```text
cumulative_gross
share_bps
cumulative_paid
```

Required properties:

1. no negative payout;
2. exact settlement conservation;
3. `sum(cumulative_paid) == cumulative_gross`;
4. each participant's lifetime proportional deviation remains strictly below one settlement-asset base unit;
5. identical canonical state and input produce identical payouts;
6. checked arithmetic only.

The Rust implementation MUST pass the existing TypeScript canonical settlement vectors before protocol implementation Gate 3 can pass.

## 17. Settlement commitment

Every successful settlement computes a `payout_commitment` over the actual ordered payout vector.

Domain separator:

```text
ROYALTYRAIL_PAYOUT_V1
```

Conceptual preimage:

```text
domain_separator
agreement_pubkey
settlement_sequence_u64_le
settlement_mode_u8
gross_amount_u64_le
participant_count_u8
for each participant in canonical order:
    participant_authority
    payout_wallet
    payout_amount_u64_le
```

Hash function: SHA-256.

The commitment is emitted in the settlement event and allows indexers to verify that decoded Token Program transfers correspond to the program's calculated distribution without emitting an oversized array in program logs.

## 18. Events

V1 event schema:

```text
ProtocolInitialized
PauseStateChanged
WorkRegistered
WorkMetadataUpdated
RevenuePoolCreated
AgreementProposed
ParticipantApproved
AgreementRejected
AgreementCancelled
AgreementActivated
AgreementSuperseded
InboxInitialized
SettlementExecuted
```

`SettlementExecuted` includes at minimum:

```text
agreement: Pubkey
version: u32
mode: SettlementMode            // Direct | Inbox
sequence: u64
gross_amount: u64
payout_commitment: [u8; 32]
direct_nonce: u64               // nonce consumed for Direct; current nonce for Inbox
slot: u64
```

Recipient transfers remain independently visible as SPL Token Program inner instructions.

## 19. V1 instruction set

```text
initialize_protocol(settlement_mint)
set_pause_state(agreements_paused, settlements_paused)

register_work(work_id, metadata_hash)
update_work_metadata(metadata_hash)

create_revenue_pool(pool_id, pool_kind, settlement_basis, metadata_hash)

propose_agreement(terms_hash, participants)
approve_agreement(expected_agreement_hash)
reject_agreement(expected_agreement_hash)
cancel_agreement()
activate_initial_agreement()
activate_next_version()

initialize_inbox()
settle_direct(amount, expected_nonce)
settle_inbox()
```

No v1 instruction may:

- arbitrarily withdraw from a Royalty Inbox;
- change payout wallets on an existing version;
- change BPS on an existing version;
- alter cumulative accounting manually;
- change settlement mint;
- change token program;
- impose or change a settlement fee;
- seize or redirect participant funds.

## 20. Pause semantics

### `agreements_paused`

When true, block:

```text
register_work
update_work_metadata
create_revenue_pool
propose_agreement
approve_agreement
activate_initial_agreement
activate_next_version
initialize_inbox
```

Still allow:

```text
reject_agreement
cancel_agreement
```

Settlement behavior is controlled separately.

### `settlements_paused`

When true, block:

```text
settle_direct
settle_inbox
```

It does not grant admin withdrawal authority and does not move funds.

Emergency settlement pause is a last-resort incident-response tool, not normal operations.

## 21. Authority model

### Pool authority

May:

- create pools under its Work;
- propose versions;
- cancel its pending proposal.

May NOT:

- approve on behalf of participants;
- modify an active/superseded version;
- redirect settlement;
- withdraw inbox funds.

### Participant authority

May:

- approve its own participant line;
- reject a proposed agreement.

May NOT:

- change any other line;
- mutate agreement terms;
- redirect an existing version's payout wallet.

### Protocol admin

May only:

- change pause flags through v1 program instructions.

Program upgrade authority is a deployment-layer control outside these application instructions and must be separately governed by the production security policy.

## 22. Account closure

For v1:

- `AgreementVersion` accounts are never closable once created;
- `RevenuePool` accounts are never closable;
- `Work` accounts are never closable;
- Royalty Inbox ATAs are not closed by RoyaltyRail.

This intentionally favors auditability and simple lifecycle semantics over rent reclamation.

A later protocol version may define safe archival rules only after historical-proof requirements are understood.

## 23. Replay and concurrency

### Direct settlement

`direct_settlement_nonce` prevents a caller from creating a fresh Solana transaction that replays an already-consumed direct settlement intent.

If two direct settlements race with the same expected nonce, at most one may succeed. The other must retry using the new state.

### Inbox settlement

No direct nonce is required. The actual inbox token balance is the amount source. A successful full flush removes the balance that was just settled.

Concurrent inbox flushes serialize through the mutable agreement and inbox accounts; a later attempt observes the post-settlement balance and fails if zero.

## 24. Account substitution defenses

The implementation MUST reject:

- wrong config PDA;
- wrong parent Work or RevenuePool relationship;
- wrong agreement PDA/version;
- wrong settlement mint;
- wrong token program;
- wrong payer ATA;
- wrong Royalty Inbox ATA;
- wrong recipient ATA;
- recipient ATAs presented out of canonical participant order;
- duplicate participant authorities;
- unsorted participant arrays;
- account ownership inconsistent with expected Solana programs.

Anchor constraints should be used wherever they make the invariant explicit; remaining-account token validation must still be performed manually where Anchor cannot statically express the variable participant set.

## 25. Solana-specific implementation constraints verified during spec work

The implementation plan relies on current documented Solana behavior:

- PDAs are deterministic, off-curve addresses with no private key; only the deriving program can authorize for them through program signing;
- PDA derivation permits at most 16 seeds and 32 bytes per individual seed;
- token accounts are tied to one mint and one token-account authority;
- an ATA is the deterministic token account derived from owner, token program, and mint;
- current Solana v1 transactions support up to 4,096 bytes and 64 inline addresses under the documented base limit, but RoyaltyRail still caps agreements at 16 recipients until measured benchmarks prove a larger surface safe.

Primary references:

- https://solana.com/docs/core/pda
- https://solana.com/docs/core/pda/pda-derivation
- https://solana.com/docs/tokens
- https://solana.com/docs/tokens/basics/create-token-account
- https://solana.com/docs/core/transactions/versioned-transactions
- https://www.anchor-lang.com/docs/references/account-constraints

## 26. Implementation gates created by this specification

The Anchor program may not be considered protocol-complete until all of the following exist and pass:

1. byte-exact agreement-hash vectors shared by TypeScript and Rust;
2. byte-exact payout-commitment vectors shared by TypeScript and Rust;
3. Rust accounting outputs matching every existing TypeScript settlement vector;
4. PDA derivation vectors for config, work, pool, agreement, and vault authority;
5. account-size assertions for every Anchor account;
6. local-validator tests for every instruction and state transition;
7. adversarial tests for account substitution and signer forgery;
8. direct-settlement nonce replay tests;
9. concurrent settlement tests;
10. full-inbox-flush tests;
11. pause-state tests;
12. proof that no instruction or CPI path can transfer Royalty Inbox USDC anywhere except canonical participant ATAs under the stored agreement.

## 27. Non-goals

This specification intentionally does not define:

- legal enforceability of music agreements;
- off-chain identity verification;
- tax reporting;
- bank/ACH settlement;
- DDEX ingestion;
- recoupment;
- priority waterfalls;
- fixed-dollar obligations;
- commissions;
- multi-currency settlement;
- wallet rotation without a new agreement version;
- DAO governance;
- protocol tokens;
- royalty investment products.

Those require separate specifications rather than hidden complexity inside v1.
