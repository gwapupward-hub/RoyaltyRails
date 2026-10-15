# RoyaltyRail Protocol Specification v1

Status: Phase 2 hardened freeze candidate  
Product: RoyaltyRail  
Network: Solana  
Settlement asset: one deployment-configured native USDC mint  
Date: 2026-10-15

> This document defines the on-chain behavior the future Anchor implementation must reproduce. It is not deployed contract code.

## 1. Purpose

RoyaltyRail v1 converts unanimously approved percentage-based revenue agreements into deterministic USDC allocations and independently claimable payouts.

The protocol does not determine legal copyright ownership, royalty rates, or contractual entitlement. It enforces an economic configuration the relevant participants approved.

The merged TypeScript accounting package is normative for percentage allocation math.

## 2. Core separation of concerns

RoyaltyRail deliberately separates three concepts:

1. **Economic agreement** — who participates and what percentage each participant receives.
2. **Revenue allocation** — applying the approved percentages to incoming USDC.
3. **Payout routing** — which wallet currently receives a participant's already-earned allocation.

Economic terms are immutable per agreement version. A participant may rotate only their own payout destination without changing anyone's share.

## 3. V1 constraints

- one Solana program deployment per environment;
- one immutable configured settlement mint per deployment;
- mainnet deployment must use the intended native Circle-issued Solana USDC mint;
- original SPL Token Program only in v1;
- 2 to 16 participants per agreement version;
- integer basis points only;
- shares total exactly 10,000 BPS;
- participant authorities are unique and canonically sorted;
- unanimous approval for proposed terms;
- replacement versions also require unanimous consent from the current predecessor participants;
- economic terms never mutate in place;
- payout wallets are participant-controlled routing state and may rotate;
- revenue allocation is separated from token claiming;
- claims are permissionless to trigger but destinations are program-determined;
- no admin withdrawal or payout override instruction exists;
- protocol settlement fee is zero in v1;
- no recoupment, waterfalls, fiat custody, arbitrary SPL assets, tokenized royalties, lending, or secondary markets.

## 4. Terminology

### Work

A descriptive root for a creative work or other revenue-generating object. It does not itself control money.

### Revenue Pool

Defines what class of revenue an agreement governs.

### Agreement Version

An economic configuration containing participant authorities, BPS shares, role metadata, approval state, predecessor-consent state, allocation accounting, claim accounting, and the canonical agreement hash.

### Participant Authority

The Solana public key that approves economic terms and controls only that participant's payout-routing state.

### Payout Wallet

The current Solana owner address whose canonical USDC ATA receives that participant's claims. It is operational routing state, not an economic term.

### Royalty Inbox

The canonical USDC ATA owned by an agreement-version-specific PDA authority. It holds newly deposited revenue plus allocated-but-unclaimed revenue.

### Allocation

The irreversible economic assignment of incoming revenue to participants according to the agreement. Allocation does not require all payout token accounts to be healthy.

### Claim

A token transfer of one participant's allocated-but-unclaimed USDC from the Royalty Inbox to that participant's current canonical payout ATA.

## 5. Canonical participant ordering

Agreement participants are strictly sorted lexicographically by the 32 raw bytes of `participant_authority` ascending.

The program rejects unsorted or duplicate authorities.

Canonical ordering:

- stabilizes agreement hashing;
- prevents duplicate participant authorities;
- prevents proposer-controlled rounding tie-break order;
- provides stable participant indices for approval/allocation vectors.

Duplicate payout wallets are permitted because distinct participants may use a common treasury/custodian destination.

## 6. Settlement semantics

Each RevenuePool stores one semantic basis:

- `OwnershipSplit`
- `RevenueParticipation`
- `PaymentDirection`

The basis explains why payment is being routed. It does not change v1 percentage arithmetic.

Pool kinds:

- `MasterReceipts`
- `CompositionReceipts`
- `Custom`

A Custom pool's exact economic meaning is anchored by its immutable metadata hash.

## 7. ProtocolConfig

PDA seeds:

```text
[b"config"]
```

Fields:

```text
schema_version: u16
bump: u8
deployment_id: [u8; 32]
governance_authority: Pubkey
guardian_authority: Pubkey
settlement_mint: Pubkey
token_program: Pubkey
agreements_paused: bool
allocations_paused: bool
claims_paused: bool
created_slot: u64
reserved: [u8; 64]
```

Rules:

- exactly one config per deployment;
- `deployment_id` is non-zero and immutable;
- settlement mint/token program are immutable;
- v1 requires the original SPL Token Program;
- guardian may set pause flags to `true` but may not transfer funds, edit agreements, or unpause;
- governance may pause/unpause and rotate guardian under the v1 control policy;
- no governance/guardian instruction may change settlement mint, participant economics, claim destinations, or user balances;
- production upgrade authority is a separate deployment-layer trust boundary and must be hardened before mainnet.

## 8. Work

PDA seeds:

```text
[b"work", origin_authority, work_id]
```

Fields:

```text
schema_version: u16
bump: u8
origin_authority: Pubkey
manager_authority: Pubkey
pending_manager_authority: Pubkey
work_id: [u8; 32]
metadata_hash: [u8; 32]
metadata_version: u32
created_slot: u64
updated_slot: u64
reserved: [u8; 64]
```

`origin_authority` is immutable and remains part of the PDA derivation. `manager_authority` may use a two-step transfer flow. Management transfer does not change participant economics.

## 9. RevenuePool

PDA seeds:

```text
[b"pool", work, pool_id]
```

Fields:

```text
schema_version: u16
bump: u8
work: Pubkey
manager_authority: Pubkey
pending_manager_authority: Pubkey
pool_id: [u8; 32]
pool_kind: RevenuePoolKind
settlement_basis: SettlementBasis
metadata_hash: [u8; 32]
latest_version: u32
active_version: u32
pending_version: u32
created_slot: u64
reserved: [u8; 64]
```

Rules:

- pool manager is initialized from Work manager;
- pool manager may later transfer independently using the same two-step pattern;
- pool kind/basis/metadata hash are immutable;
- at most one pending agreement version exists;
- version numbers increase monotonically and are never reused.

## 10. Participant state

Serialized inside AgreementVersion:

```text
participant_authority: Pubkey
payout_wallet: Pubkey
share_bps: u16
role_code: u16
payout_revision: u32
cumulative_allocated: u128
cumulative_claimed: u128
```

Immutable economic fields after proposal:

```text
participant_authority
share_bps
role_code
```

Mutable participant-controlled/settlement fields:

```text
payout_wallet
payout_revision
cumulative_allocated
cumulative_claimed
```

The agreement hash intentionally excludes `payout_wallet`, `payout_revision`, and accounting fields.

## 11. AgreementVersion

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
predecessor_version: u32
status: AgreementStatus
settlement_mint: Pubkey
token_program: Pubkey
terms_hash: [u8; 32]
agreement_hash: [u8; 32]
participants: Vec<Participant>          // max 16
approval_bitmap: u16
supersession_approval_bitmap: u16
cumulative_gross: u128
direct_funding_nonce: u64
allocation_sequence: u64
created_slot: u64
activated_slot: u64
superseded_slot: u64
reserved: [u8; 128]
```

Statuses:

```text
Proposed
Active
Superseded
Cancelled
```

Rules:

- `predecessor_version = 0` only for an initial version;
- a replacement snapshots the current `pool.active_version` as predecessor;
- 2..=16 participants;
- shares non-zero and total 10,000;
- participant authorities strictly sorted/unique;
- every participant must select a non-default payout wallet before activation;
- Active and Superseded versions may continue allocation/claims for historical revenue;
- Proposed and Cancelled versions may not receive protocol allocations or claims;
- all arithmetic checked;
- participant `cumulative_claimed <= cumulative_allocated` always;
- `sum(cumulative_allocated) == cumulative_gross` always.

## 12. Royalty Inbox

Vault authority PDA:

```text
[b"vault", agreement_version]
```

No rent-bearing RoyaltyRail state account is created for this authority.

The Royalty Inbox is the canonical ATA for:

```text
owner = vault_authority_pda
mint  = agreement.settlement_mint
program = original SPL Token Program
```

It may be initialized permissionlessly for Active or Superseded versions.

No instruction exists to arbitrarily withdraw from this inbox.

## 13. Inbox accounting invariant

Let:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
```

The Royalty Inbox token balance must satisfy:

```text
inbox_balance >= allocated_unclaimed
```

The difference is newly deposited, not-yet-allocated revenue:

```text
unallocated = inbox_balance - allocated_unclaimed
```

Claims reduce both inbox balance and `allocated_unclaimed` by the same amount, so they do not change `unallocated`.

External deposits increase inbox balance only, therefore increasing `unallocated`.

Allocating inbox revenue increases cumulative allocation until `unallocated` is reduced to zero.

## 14. Agreement hash

Domain:

```text
ROYALTYRAIL_AGREEMENT_V1
```

Canonical preimage:

```text
domain_separator
deployment_id
program_id
revenue_pool_pubkey
version_u32_le
predecessor_version_u32_le
settlement_mint
token_program
pool_kind_u8
settlement_basis_u8
pool_metadata_hash
terms_hash
participant_count_u8
for each participant in canonical authority order:
    participant_authority
    share_bps_u16_le
    role_code_u16_le
```

Hash function: SHA-256.

Payout wallet is excluded because participants retain unilateral control of their own delivery destination.

## 15. Proposed-agreement approval

`approve_agreement(expected_agreement_hash, payout_wallet)` requires:

- agreements not paused;
- status Proposed;
- signer matches one proposed participant authority;
- expected hash equals stored hash;
- participant approval bit not already set;
- payout wallet is not default/zero.

Effects:

- participant payout wallet is set;
- payout revision becomes 1 on first approval;
- participant approval bit is set;
- `ParticipantApproved` emitted.

A participant may update their payout wallet later without changing agreement economics.

## 16. Replacement/supersession consent

A replacement version cannot remove or reduce an existing participant without predecessor consent.

For a replacement proposal:

- `predecessor_version` must equal the current active version when proposed;
- all proposed participants must approve the new agreement;
- every participant in the predecessor Active version must separately approve supersession of that predecessor by the exact new agreement hash.

`approve_supersession(expected_new_agreement_hash)` requires:

- new version status Proposed;
- supplied predecessor equals `new.predecessor_version` and current pool active version;
- signer appears in predecessor participant list;
- expected new hash matches;
- predecessor consent bit not already set.

Activation requires both complete masks.

A continuing participant may approve both roles in one user transaction containing multiple protocol instructions.

A participant present in either the predecessor or proposed version may explicitly reject the proposal, cancelling it.

## 17. Initial activation

Initial activation requires:

```text
predecessor_version == 0
pool.active_version == 0
approval_bitmap == required_mask(new participant count)
all payout_wallet fields initialized
```

Any caller may activate after conditions are satisfied.

## 18. Replacement activation

Replacement activation requires atomically:

```text
new.status == Proposed
old.status == Active
new.predecessor_version == old.version
old.version == pool.active_version
new.version == pool.pending_version
new approval bitmap complete
supersession approval bitmap complete for all old participants
all new payout wallets initialized
```

Then:

```text
old.status = Superseded
new.status = Active
pool.active_version = new.version
pool.pending_version = 0
```

No old participant can be silently removed.

## 19. Participant-controlled payout rotation

Instruction:

```text
update_payout_wallet(new_payout_wallet: Pubkey)
```

Requires:

- signer equals participant authority;
- agreement status in {Proposed, Active, Superseded};
- new wallet non-default and different from current wallet.

Effects:

```text
participant.payout_wallet = new wallet
participant.payout_revision += 1
emit PayoutWalletUpdated
```

This changes routing only. It does not change agreement hash, shares, role, or allocations.

## 20. Direct funding + allocation

Instruction:

```text
fund_and_allocate(
    amount: u64,
    expected_nonce: u64,
    payment_reference: [u8; 32]
)
```

High-level accounts:

```text
config
agreement_version (mutable)
payer_authority (signer)
payer_source_token_account (mutable)
vault_authority_pda
royalty_inbox_ata (mutable)
settlement_mint
token_program
```

Rules:

- agreement Active or Superseded;
- allocations not paused;
- amount > 0;
- expected nonce equals agreement direct funding nonce;
- payer source is an original SPL Token account for configured mint;
- payer source token authority equals `payer_authority` signer;
- source does not need to be the payer's ATA;
- delegated-source support is not part of v1;
- amount is transferred payer source -> Royalty Inbox;
- same canonical allocation engine allocates exactly `amount`;
- `direct_funding_nonce += 1`;
- `allocation_sequence += 1`;
- allocation commitment/event emitted.

The transaction does not require recipient token accounts.

## 21. Plain inbox allocation

Instruction:

```text
allocate_inbox()
```

Permissionless.

The instruction computes:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
unallocated = inbox_balance - allocated_unclaimed
```

Requirements:

- agreement Active or Superseded;
- allocations not paused;
- canonical Royalty Inbox;
- `inbox_balance >= allocated_unclaimed`;
- `unallocated > 0`.

It allocates exactly `unallocated`, increments `allocation_sequence`, and emits an allocation commitment with:

```text
mode = Inbox
payment_reference = [0; 32]
```

The program does not pretend one reference describes an allocation that may aggregate multiple plain deposits.

## 22. Allocation arithmetic

The merged TypeScript reference engine is normative.

Required properties:

1. no negative allocation;
2. exact conservation of every allocation amount;
3. `sum(cumulative_allocated) == cumulative_gross`;
4. each participant's lifetime proportional deviation stays strictly below one asset base unit;
5. canonical state/input yields deterministic allocations;
6. checked arithmetic only.

Token claiming is not part of percentage math.

## 23. Allocation commitment

Domain:

```text
ROYALTYRAIL_ALLOCATION_V1
```

Canonical preimage:

```text
domain_separator
deployment_id
agreement_pubkey
allocation_sequence_u64_le
allocation_mode_u8
gross_amount_u64_le
payment_reference[32]
participant_count_u8
for each participant in canonical order:
    participant_authority
    allocation_amount_u64_le
```

Hash function: SHA-256.

For each successful allocation, sequence is defined as the **post-increment human sequence number**:

```text
new_sequence = prior_allocation_sequence + 1
```

The commitment is computed using `new_sequence`, then that same value is stored.

## 24. Claims

Instruction:

```text
claim_participant(participant_index: u8)
```

Permissionless to trigger.

Required accounts include:

```text
config
agreement_version (mutable)
vault_authority_pda
royalty_inbox_ata (mutable)
participant_payout_ata (mutable)
settlement_mint
token_program
```

Rules:

- agreement Active or Superseded;
- claims not paused;
- index valid;
- canonical Royalty Inbox;
- payout ATA is the canonical ATA for the participant's current payout wallet and configured mint;
- claimable = cumulative_allocated - cumulative_claimed;
- claimable > 0;
- claimable fits u64;
- inbox contains at least claimable;
- vault PDA signs one TransferChecked CPI;
- participant cumulative claimed increases exactly by transferred amount;
- `PayoutClaimed` event emitted.

No participant signature is required to receive funds. Anyone may pay transaction fees to push a participant's claim.

One broken/frozen recipient destination therefore cannot block claims for other participants.

## 25. Recipient ATA lifecycle

Recipient ATAs may be prepared permissionlessly by Studio/SDK/third parties.

If an ATA is absent, only that participant's claim is unavailable until the ATA is created.

If a participant's current destination becomes unusable, the participant authority may rotate payout wallet and then claim to the new canonical ATA.

Settlement/allocation for everyone else remains live.

## 26. Payment reconciliation

`payment_reference` is a 32-byte opaque external reconciliation value for direct funding. Suggested uses:

- distributor statement/batch ID hash;
- invoice ID hash;
- source-system transaction ID hash;
- platform payment intent hash.

It is included in the allocation commitment/event but is **not** replay protection or an on-chain uniqueness guarantee.

Plain external deposits may additionally use standard Solana memos/references for off-chain correlation.

## 27. Management authority transfer

Work and RevenuePool manager changes use two-step handoff:

```text
propose_manager(new_manager)
accept_manager()
```

Current manager proposes; new manager must sign acceptance.

Management controls metadata/proposal creation only. It cannot bypass participant approvals or predecessor supersession consent.

## 28. Pause model

Pause domains are independent:

```text
agreements_paused
allocations_paused
claims_paused
```

Guardian may only move a pause from false -> true.
Governance may pause/unpause and rotate guardian.

No pause instruction moves tokens or alters economics.

Production governance/guardian should be separate hardened authorities where operationally practical.

## 29. Events

Minimum v1 events:

```text
ProtocolInitialized
PauseStateChanged
GuardianChanged
WorkRegistered
WorkMetadataUpdated
ManagerTransferProposed
ManagerTransferAccepted
RevenuePoolCreated
AgreementProposed
ParticipantApproved
SupersessionApproved
AgreementRejected
AgreementCancelled
AgreementActivated
AgreementSuperseded
PayoutWalletUpdated
RoyaltyInboxInitialized
RevenueAllocated
PayoutClaimed
```

`RevenueAllocated` includes at least:

```text
agreement
allocation_sequence
mode
gross_amount
payment_reference
allocation_commitment
```

`PayoutClaimed` includes at least:

```text
agreement
participant_index
participant_authority
payout_wallet
payout_revision
amount
```

## 30. Reserved storage and schema evolution

All long-lived program accounts contain zeroed reserved bytes.

V1 ignores them. A future schema may interpret them only under an explicit reviewed schema migration.

No future upgrade may reinterpret reserved bytes to silently change existing participant economics.

## 31. Public-data model

V1 is public-chain infrastructure. Participant authorities, percentages, agreement state, allocations, claims, and token flows are publicly observable.

Studio must disclose this before approval. V1 does not claim confidential royalty splits.

## 32. User-experience requirements

The protocol is designed so Studio can hide blockchain complexity:

- off-chain draft/invite phase before on-chain proposal;
- participants see human-readable terms before signing;
- transaction fees may be sponsored by a separate fee payer, so participants do not need SOL merely to approve;
- one-click amendment approval may bundle proposed-term approval plus predecessor supersession consent;
- payout wallet defaults may be suggested, but participant chooses their own destination;
- payout rotation does not require group approval;
- keepers may automatically allocate deposits and claim for healthy recipients;
- protocol remains callable without RoyaltyRail Studio/API.

## 33. Integration requirements

RoyaltyRail SDK/API should expose deterministic helpers for:

```text
derive work/pool/agreement/vault/inbox addresses
construct canonical agreement hashes
read approval + supersession status
fund_and_allocate
allocate_inbox
calculate claimable amount
claim_participant
rotate payout wallet
build reconciliation references
verify allocation commitments
```

The protocol should support standard Solana transaction/CPI composition and must not rely on trusted RoyaltyRail backend authorization.

## 34. Explicit V1 exclusions

Not included:

- recoupment/waterfalls;
- fixed-dollar obligations;
- multi-tier royalties;
- territory-specific calculations;
- fiat custody;
- arbitrary SPL/Token-2022 assets;
- exchange functions;
- lending;
- tokenized royalty investments;
- secondary markets;
- DAO governance;
- automated legal ownership determination;
- confidential/private on-chain splits;
- full DDEX implementation;
- delegated direct-funding token authority;
- protocol-level payment-reference deduplication.

## 35. Gate to Anchor implementation

Phase 3 must not begin from any contradictory earlier draft.

Before the Anchor implementation is considered conformant, it must prove:

- TypeScript/Rust allocation vector parity;
- agreement/allocation commitment vector parity;
- predecessor-consent enforcement;
- participant payout rotation isolation;
- inbox balance/accounting invariants;
- claim isolation (one unhealthy recipient does not block another);
- exact PDA/ATA validation;
- manager/guardian/governance authority boundaries;
- 16-participant bitmap/account-size/compute behavior;
- no instruction/CPI path can arbitrarily transfer Royalty Inbox funds.
