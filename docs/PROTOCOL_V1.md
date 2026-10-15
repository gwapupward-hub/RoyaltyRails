# RoyaltyRail Protocol Specification v1

Status: Phase 2 hardened freeze candidate  
Product: RoyaltyRail  
Network: Solana  
Settlement asset: one deployment-configured native USDC mint  
Date: 2026-10-15

> This document defines the Solana behavior the future Anchor implementation must reproduce. It is not deployed contract code.

## 1. Protocol objective

RoyaltyRail v1 turns unanimously approved percentage-based revenue agreements into deterministic USDC allocations and independently claimable payouts.

RoyaltyRail does not determine who legally owns a copyright or what a royalty rate should be. It enforces an economic configuration the relevant parties approved.

Three concerns are deliberately separated:

```text
Economic agreement
      ↓
Revenue allocation
      ↓
Payout routing / claims
```

Economic terms are immutable per agreement version. A participant may rotate only their own payout destination without changing anyone's economic rights.

## 2. V1 constraints

- Solana;
- one immutable configured settlement mint per deployment;
- mainnet deployment uses the intended native Circle-issued Solana USDC mint;
- original SPL Token Program only;
- 1–16 participants per agreement version;
- integer BPS only;
- active shares total exactly 10,000 BPS;
- canonical unique participant authorities;
- unanimous proposed-participant approval;
- replacement versions also require unanimous predecessor supersession consent;
- immutable economic terms after proposal;
- participant-controlled payout-wallet rotation;
- revenue allocation separated from token claiming;
- direct funding + allocation and address-only Royalty Inbox funding;
- permissionless inbox allocation;
- permissionless participant claims to program-determined destinations;
- zero protocol settlement fee in v1;
- no admin withdrawal or payout override path.

Explicitly deferred: recoupment, waterfalls, negative allocations, fiat custody, arbitrary SPL assets, Token-2022, lending, royalty tokenization, secondary markets, private/confidential splits, automated rights adjudication, and full DDEX implementation.

## 3. Core objects

### Work
A descriptive root for a creative work or revenue-generating object.

### RevenuePool
Defines the class of revenue governed by an agreement.

Pool kinds:

```text
MasterReceipts
CompositionReceipts
Custom
```

Settlement bases:

```text
OwnershipSplit
RevenueParticipation
PaymentDirection
```

The label explains why payment is routed; it does not change v1 percentage arithmetic.

### AgreementVersion
Immutable economic configuration plus mutable approval, allocation, claim, and participant payout-routing state.

### ParticipantAuthority
Public key that approves economic terms and controls that participant's payout routing.

### PayoutWallet
Current owner address whose canonical USDC ATA receives a participant's claims. This is routing state, not an economic term.

### RoyaltyInbox
Canonical USDC ATA owned by an agreement-version-specific PDA. It holds both not-yet-allocated deposits and allocated-but-unclaimed USDC.

## 4. Canonical participant ordering

Participants are strictly sorted lexicographically by raw 32-byte `participant_authority` ascending.

Program rejects duplicate or unsorted authorities.

Canonical ordering stabilizes agreement hashing, approval indices, supersession-consent indices, and allocation rounding tie-breaks.

Duplicate payout wallets are allowed.

A one-participant agreement is valid only when that participant has exactly 10,000 BPS. This supports buyouts, full assignments, estates/entities, and a collaborator's consented exit from a prior version.

## 5. ProtocolConfig

PDA:

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
- non-zero immutable deployment ID;
- immutable settlement mint/token program;
- original SPL Token Program only;
- settlement mint must be initialized and use expected USDC decimal precision for that deployment;
- guardian may set pause flags false -> true only;
- governance may pause/unpause and rotate guardian;
- neither authority may move participant funds or alter agreement economics;
- program upgrade authority is a separate deployment-layer trust boundary.

## 6. Work

PDA:

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

`origin_authority` is immutable because it participates in PDA derivation. Management may transfer with a two-step propose/accept flow.

## 7. RevenuePool

PDA:

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

Manager may propose agreements but cannot activate around participant consent. At most one pending version exists. Versions monotonically increase and are never reused. Pool kind, settlement basis and pool metadata semantics are immutable.

## 8. Participant state

Embedded in AgreementVersion:

```text
participant_authority: Pubkey
payout_wallet: Pubkey
share_bps: u16
payout_revision: u32
cumulative_allocated: u128
cumulative_claimed: u128
```

Immutable economic fields:

```text
participant_authority
share_bps
```

Mutable participant/settlement fields:

```text
payout_wallet
payout_revision
cumulative_allocated
cumulative_claimed
```

Detailed creative roles and credits are **not on-chain economic fields**. A participant may have multiple roles; role vocabularies also evolve. Roles live in the deterministic Agreement Manifest anchored by `terms_hash`.

Agreement hash excludes payout routing/accounting state.

## 9. AgreementVersion

PDA:

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
participants: Vec<Participant>      // max 16
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

Invariants:

- initial version has `predecessor_version == 0`;
- replacement snapshots current active version as predecessor;
- participant count 1..=16;
- shares positive and total 10,000;
- authorities canonical/unique;
- all proposed participants select a non-default payout wallet before activation;
- Active and Superseded versions may allocate historical revenue and pay outstanding claims;
- Proposed/Cancelled versions may not receive protocol allocations/claims;
- `cumulative_claimed <= cumulative_allocated` for every participant;
- `sum(cumulative_allocated) == cumulative_gross`.

## 10. Royalty Inbox

Vault authority PDA:

```text
[b"vault", agreement_version]
```

No separate rent-bearing vault-authority state account exists.

Royalty Inbox is the canonical original-SPL ATA for:

```text
owner = vault_authority_pda
mint = agreement.settlement_mint
```

It may be initialized permissionlessly for Active or Superseded versions. No instruction exists to arbitrarily withdraw the inbox balance.

## 11. Inbox solvency and unallocated revenue

Define:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
```

Required invariant:

```text
inbox_balance >= allocated_unclaimed
```

Then:

```text
unallocated = inbox_balance - allocated_unclaimed
```

Operation effects:

```text
external deposit:
    inbox_balance ↑
    unallocated ↑ equally

claim x:
    inbox_balance ↓ x
    allocated_unclaimed ↓ x
    unallocated unchanged

allocate_inbox:
    cumulative_gross ↑ unallocated
    allocated_unclaimed ↑ unallocated
    unallocated becomes 0
```

Because an SPL token-account balance is `u64`:

```text
sum(current claimable) <= inbox_balance <= u64::MAX
```

so every individual current claim fits an SPL `u64` transfer even though lifetime counters use `u128`.

## 12. Agreement hash

Domain:

```text
ROYALTYRAIL_AGREEMENT_V1
```

SHA-256 preimage:

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
for each canonical participant:
    participant_authority
    share_bps_u16_le
```

Payout wallet and creative-role metadata are intentionally excluded from the core economic serialization. Roles remain cryptographically anchored through `terms_hash`.

The TypeScript canonical encoder/vector is the cross-language interoperability target.

## 13. Agreement Manifest

`terms_hash` anchors the deterministic human-readable Agreement Manifest defined in `AGREEMENT_MANIFEST_V1.md`.

Manifest responsibilities include work/release identifiers, pool definition, gross/net convention, source description, negative-adjustment policy, rich/multi-valued participant roles/credits, effective-period metadata, document hashes, and disclosure/terms metadata.

Studio must recompute manifest hash and agreement hash before requesting approval.

## 14. Proposed participant approval

Instruction concept:

```text
approve_agreement(expected_agreement_hash, payout_wallet)
```

Requires agreements not paused, Proposed status, signer matching one participant authority, exact expected hash, unset approval bit, and a non-default payout wallet.

Effects:

```text
set participant payout_wallet
set payout_revision = 1 on initial approval
set approval bit
emit ParticipantApproved
```

## 15. Replacement / supersession consent

A replacement may not silently remove or reduce an existing participant.

Replacement activation requires two complete consent sets:

1. every participant in the proposed version approves the new agreement;
2. every participant in the currently Active predecessor approves supersession by that exact new agreement hash.

The supersession bitmap is indexed by predecessor canonical participant order, not proposed-version order.

A continuing participant may perform both approvals in one user transaction. A participant present in either consent set may reject the pending proposal, cancelling it.

## 16. Activation

Initial activation requires Proposed status, `predecessor_version == 0`, no active version, complete proposed approval mask, and initialized payout wallets.

Replacement activation additionally requires the exact current Active predecessor, complete proposed approval mask, complete predecessor supersession mask, and initialized new payout wallets.

Atomic replacement:

```text
old.status = Superseded
new.status = Active
pool.active_version = new.version
pool.pending_version = 0
```

Any caller may trigger activation after consent is complete.

For 16 participants:

```text
required_mask = u16::MAX
```

Never compute `1u16 << 16`.

## 17. Payout-wallet rotation

```text
update_payout_wallet(new_payout_wallet)
```

Requires exact participant authority signer and Proposed/Active/Superseded status. Reject default/no-op destination.

Effects:

```text
payout_wallet = new destination
payout_revision += 1
emit PayoutWalletUpdated
```

It changes no economic field and no agreement hash.

## 18. Pure allocation engine

The TypeScript reference engine is normative percentage math. It consumes only agreement shares, cumulative allocation state, and new allocation amount.

It does not contain funding-path nonce state, payout wallets, claims, or token logic.

Both direct and inbox allocation use the same economic function.

Required properties: exact conservation, non-negative allocation, bounded lifetime proportional error under one base unit per participant, checked integer arithmetic, deterministic canonical output, and 1–16 participant support.

## 19. Direct funding + allocation

```text
fund_and_allocate(
    amount: u64,
    expected_nonce: u64,
    payment_reference: [u8; 32]
)
```

Rules:

- agreement Active or Superseded;
- allocations unpaused;
- amount > 0;
- expected nonce equals stored direct nonce;
- payer source is configured-mint original-SPL token account;
- payer signer is source token authority;
- source need not be an ATA;
- delegated SPL authority is deferred;
- transfer exact amount source -> Royalty Inbox;
- run pure allocation engine for exact amount;
- increment direct nonce once;
- increment allocation sequence once;
- emit allocation commitment/event.

Recipient token accounts are not required. Direct nonce is a protocol replay control, not an economic-engine field.

## 20. Address-only inbox allocation

```text
allocate_inbox()
```

Permissionless.

Compute:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
unallocated = inbox_balance - allocated_unclaimed
```

Requires canonical inbox, valid status, allocations unpaused, solvency and `unallocated > 0`.

It allocates exactly `unallocated`, increments allocation sequence, and **does not change `direct_funding_nonce`**.

Inbox allocation commitment uses `mode = Inbox` and zero payment reference because one allocation may aggregate multiple raw deposits.

## 21. Allocation commitment

Domain:

```text
ROYALTYRAIL_ALLOCATION_V1
```

SHA-256 preimage:

```text
domain_separator
deployment_id
agreement_pubkey
allocation_sequence_u64_le
allocation_mode_u8
gross_amount_u64_le
payment_reference[32]
participant_count_u8
for each canonical participant:
    participant_authority
    allocation_amount_u64_le
```

Sequence begins at zero. A successful allocation commits to `new_sequence = old_sequence + 1`, then persists that value.

`payment_reference` is reconciliation metadata, not protocol idempotency/replay protection.

## 22. Claims

```text
claim_participant(participant_index: u8)
```

Permissionless to trigger.

Requires Active/Superseded status, claims unpaused, valid index, canonical Royalty Inbox, canonical ATA for participant's current payout wallet + configured mint, positive claimable amount, and sufficient inbox balance.

Vault PDA signs a checked SPL transfer. On success:

```text
cumulative_claimed += claimable
emit PayoutClaimed
```

One broken/frozen/missing recipient destination cannot block another participant's independent claim transaction.

## 23. Missing recipient ATA

ATA creation is independent from economic allocation. Studio/SDK may compose idempotent ATA creation + `claim_participant` for one recipient where transaction constraints permit. Failure leaves claimable state unchanged.

## 24. Direct payment reconciliation and retries

`payment_reference` is an opaque 32-byte value suitable for hashes of invoice IDs, distributor batches, platform payment IDs, etc. It is not a global on-chain uniqueness set.

SDK/API must preserve business idempotency: retain business reference across retries, resolve uncertain transaction status before funding again with a fresh nonce, and expose ambiguous confirmation rather than blindly double-paying.

A future optional receipt PDA may be added if enterprise demand justifies state/rent cost.

## 25. Raw-deposit irreversibility

Plain token transfers to a Royalty Inbox are a legacy/address-only fallback. Once raw USDC is allocated, v1 has no administrator refund path.

Studio/API must clearly warn payers to verify network, native USDC mint, AgreementVersion, inbox address and amount. Encourage a small test payment for unfamiliar large-value senders.

## 26. Negative adjustments and disputes

V1 never creates negative allocations and never claws back claimed tokens. Corrected royalty statements/returns/negative adjustments must be netted before new distributable USDC is deposited or resolved commercially outside v1.

V1 executes resolved 10,000-BPS payment instructions. It does not adjudicate under-claims, over-claims, contested rights, or unknown shares. Future suspense/dispute/offset modules require separate specifications.

## 27. Management authority transfer

Work/RevenuePool management uses two-step `propose_manager(new_manager)` / `accept_manager()`. Management controls metadata and proposal creation, not participant economics, claims, or payout routing.

## 28. Pause model

Independent domains:

```text
agreements_paused
allocations_paused
claims_paused
```

Guardian may only pause. Governance may pause/unpause and rotate guardian. Pause instructions never transfer funds or edit economics.

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

`RevenueAllocated` includes agreement, allocation sequence, mode, gross amount, payment reference and allocation commitment.

`PayoutClaimed` includes agreement, participant index/authority, payout wallet/revision and amount.

## 30. Public-data and privacy model

V1 is public-chain infrastructure. Do not put tax IDs, bank details, home addresses, private emails, government IDs or private contract text on-chain.

Participant authorities, percentages, allocations, claims and token flows are public. Studio must disclose this before approval. Private royalty splits require a future distinct design.

## 31. User experience requirements

Studio should hide protocol jargon and provide off-chain drafts/invites, deterministic human-readable manifest review, recomputed hash verification, sponsored transaction fees where appropriate, one-click dual amendment consent for continuing participants, participant-owned payout routing, automatic keeper-driven allocations/claims, actionable claim-failure states, and exportable evidence packages.

A transaction fee sponsor may pay SOL while the relevant participant still supplies the required authorization signature.

## 32. Integration requirements

Canonical SDK helpers should cover address derivation, Agreement Manifest canonicalization/hashing, agreement hashing, approval/supersession flows, direct funding, inbox allocation, claimability, ATA preparation, participant claiming, payout rotation, reconciliation references and allocation-commitment verification.

Protocol correctness must never depend on RoyaltyRail's hosted backend.

## 33. Transaction-format compatibility

Do not require Solana v1-format transactions unless an operation needs them. Phase 3 benchmarks must test maximum-participant proposal/approval/claim flows across supported formats.

If v1 transactions are used, SDK must explicitly configure v1 message resources/priority rather than assume legacy/v0 ComputeBudget behavior.

## 34. Storage and schema evolution

Long-lived RoyaltyRail accounts reserve zeroed padding bytes. Future versions may interpret reserved bytes only through explicit reviewed schema migration. Reserved bytes may never become a backdoor for altering existing economics.

RoyaltyRail-owned historical Work/Pool/Agreement accounts and Royalty Inbox accounts are not closed through v1 instructions.

## 35. Mainnet trust boundary

Before meaningful mainnet value:

- upgrade authority uses hardened multisig/governance;
- normal upgrade delay/timelock policy is explicit;
- deployed program/ProgramData changes monitored;
- reproducible/verifiable builds published;
- emergency upgrade process documented;
- independent security audit complete;
- payments/fintech and entertainment legal architecture reviewed;
- long-term immutability policy decided.

## 36. Phase 3 conformance gate

Anchor implementation must prove:

- Rust/TypeScript allocation-vector parity;
- agreement/allocation hash parity;
- 1–16 participant behavior;
- 16-participant bitmap safety;
- direct nonce affects only direct funding;
- inbox allocations do not consume direct nonce;
- predecessor unanimous supersession consent;
- payout-wallet rotation isolation;
- vault solvency under arbitrary deposit/allocation/claim interleavings;
- one failed recipient claim cannot block another;
- exact PDA/ATA/mint/token-program validation;
- manager/guardian/governance boundaries;
- maximum account-size and compute behavior;
- no CPI/instruction path can arbitrarily transfer Royalty Inbox funds.
