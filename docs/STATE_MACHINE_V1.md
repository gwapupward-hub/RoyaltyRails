# RoyaltyRail Agreement State Machine v1

Status: Phase 2 hardened freeze candidate  
Date: 2026-10-15

This document defines legal state transitions for `RevenuePool` and `AgreementVersion` accounts and the independent payout-routing state owned by participants.

## 1. Agreement statuses

```text
Proposed
Active
Superseded
Cancelled
```

There is no mutable on-chain Draft. Drafting/invitation is an off-chain Studio/API concern.

## 2. Agreement status transitions

```text
             proposed participants approve
             predecessor participants consent
                         │
                         ▼
                  ┌──────────┐
                  │ Proposed │
                  └────┬─────┘
                       │
           ┌───────────┼─────────────┐
           │           │             │
           │ activate  │ cancel      │ reject
           ▼           ▼             ▼
       ┌────────┐  ┌───────────┐  ┌───────────┐
       │ Active │  │ Cancelled │  │ Cancelled │
       └────┬───┘  └───────────┘  └───────────┘
            │
            │ newer fully-consented version activates
            ▼
     ┌────────────┐
     │ Superseded │
     └────────────┘
```

Cancelled and Superseded are terminal agreement-status states. Superseded versions remain economically usable for delayed/historical revenue and outstanding claims.

## 3. RevenuePool version pointers

```text
latest_version: u32
active_version: u32
pending_version: u32
```

Invariants:

```text
latest_version >= active_version
latest_version >= pending_version
active_version == 0 || active_version <= latest_version
pending_version == 0 || pending_version <= latest_version
```

At most one pending version exists. Version numbers are monotonically increasing and never reused.

## 4. Proposal creation

Initial proposal:

```text
predecessor_version = 0
pool.active_version = 0
```

Replacement proposal:

```text
predecessor_version = pool.active_version
pool.active_version != 0
```

Preconditions:

```text
agreements_paused == false
caller == pool.manager_authority
pool.pending_version == 0
participant_count in 2..=16
sum(shares) == 10_000
participants strictly sorted and unique
all shares > 0
```

Effects:

```text
new_version = latest_version + 1
create AgreementVersion(status = Proposed)
pool.latest_version = new_version
pool.pending_version = new_version
```

All proposed participant payout wallets initialize to the default/unset value. They are chosen by each participant during approval.

## 5. Proposed participant approval

`approve_agreement(expected_hash, payout_wallet)` preconditions:

```text
agreements_paused == false
agreement.status == Proposed
pool.pending_version == agreement.version
signer == one proposed participant_authority
expected_hash == agreement.agreement_hash
participant approval bit == 0
payout_wallet != default pubkey
```

Effects:

```text
participant.payout_wallet = chosen wallet
participant.payout_revision = 1
set proposed-participant approval bit
```

Status remains Proposed.

## 6. Predecessor supersession consent

For a replacement version, every participant in the current Active predecessor must consent to the exact replacement hash.

`approve_supersession(expected_new_hash)` preconditions:

```text
new.status == Proposed
new.predecessor_version != 0
old.version == new.predecessor_version
old.version == pool.active_version
old.status == Active
signer == one old participant_authority
expected_new_hash == new.agreement_hash
old-participant supersession bit in new == 0
```

Effect:

```text
set supersession approval bit in new AgreementVersion
```

A participant who appears in both versions satisfies both roles. Studio may submit `approve_agreement` and `approve_supersession` in one transaction so the user sees one approval action.

## 7. Rejection

A Proposed agreement may be rejected by:

- any participant in the proposed version; or
- for replacement versions, any participant in the current predecessor version.

The rejecting signer supplies the expected new agreement hash.

Effects:

```text
new.status = Cancelled
pool.pending_version = 0
```

Existing active/superseded agreements and allocations are unchanged.

## 8. Manager cancellation

Pool manager may cancel only a Proposed version.

Effects:

```text
agreement.status = Cancelled
pool.pending_version = 0
```

Cancelled version number is never reused.

## 9. Initial activation

Preconditions:

```text
agreements_paused == false
new.status == Proposed
new.predecessor_version == 0
pool.active_version == 0
pool.pending_version == new.version
approval_bitmap == required_mask(new participant count)
all new participant payout_wallet values initialized
```

Effects:

```text
new.status = Active
new.activated_slot = current_slot
pool.active_version = new.version
pool.pending_version = 0
```

Any caller may trigger activation after consent is complete.

## 10. Replacement activation

Preconditions:

```text
agreements_paused == false
new.status == Proposed
old.status == Active
new.predecessor_version == old.version
old.version == pool.active_version
new.version == pool.pending_version
new approval bitmap complete
new supersession approval bitmap == required_mask(old participant count)
all new participant payout_wallet values initialized
```

Atomic effects:

```text
old.status = Superseded
old.superseded_slot = current_slot
new.status = Active
new.activated_slot = current_slot
pool.active_version = new.version
pool.pending_version = 0
```

This is the core anti-removal invariant: a participant in the current agreement cannot be silently removed merely by omitting them from the proposed participant list.

## 11. Economic immutability

After proposal creation, these fields never change:

```text
revenue_pool
version
predecessor_version
settlement_mint
token_program
terms_hash
agreement_hash
participant_authority
share_bps
role_code
```

Mutable fields are limited to:

```text
status
approval_bitmap
supersession_approval_bitmap
participant.payout_wallet
participant.payout_revision
participant.cumulative_allocated
participant.cumulative_claimed
direct_funding_nonce
allocation_sequence
activated_slot
superseded_slot
```

Mutable payout routing is not an economic amendment.

## 12. Payout-wallet rotation

`update_payout_wallet(new_wallet)` preconditions:

```text
agreement.status in {Proposed, Active, Superseded}
signer == participant.participant_authority
new_wallet != default pubkey
new_wallet != current payout_wallet
```

Effects:

```text
participant.payout_wallet = new_wallet
participant.payout_revision += 1
emit PayoutWalletUpdated
```

No other participant signature is required because shares/rights are unchanged.

Cancelled agreements reject payout updates.

## 13. Allocation eligibility

Revenue allocation is permitted only when:

```text
agreement.status in {Active, Superseded}
allocations_paused == false
agreement settlement mint/token program match config
```

Proposed and Cancelled versions cannot allocate revenue through RoyaltyRail instructions.

## 14. Direct funding + allocation transition

Preconditions:

```text
agreement eligible for allocation
amount > 0
expected_nonce == direct_funding_nonce
payer source token account mint == configured settlement mint
payer source token authority == payer signer
royalty inbox == canonical agreement-version ATA
```

Atomic effects:

```text
transfer amount payer_source -> royalty_inbox
compute canonical allocation vector
cumulative_gross += amount
participant.cumulative_allocated[i] += allocation[i]
direct_funding_nonce += 1
allocation_sequence += 1
emit RevenueAllocated
```

No recipient payout ATA is needed.

## 15. Plain inbox allocation transition

Before allocation define:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
```

Preconditions:

```text
agreement eligible for allocation
royalty inbox canonical
inbox_balance >= allocated_unclaimed
unallocated = inbox_balance - allocated_unclaimed
unallocated > 0
```

Effects:

```text
allocate exactly unallocated
cumulative_gross += unallocated
participant.cumulative_allocated[i] += allocation[i]
allocation_sequence += 1
emit RevenueAllocated(mode = Inbox, payment_reference = zero)
```

No token leaves the inbox during allocation.

## 16. Claim transition

`claim_participant(index)` is permissionless to trigger.

Preconditions:

```text
agreement.status in {Active, Superseded}
claims_paused == false
participant index valid
claimable = cumulative_allocated - cumulative_claimed
claimable > 0
royalty inbox canonical
payout ATA == canonical ATA for current participant payout_wallet + settlement mint
inbox balance >= claimable
```

Atomic effects:

```text
transfer claimable royalty_inbox -> participant payout ATA
participant.cumulative_claimed += claimable
emit PayoutClaimed
```

A failure for participant A does not change participant B's claimable state and does not prevent a separate transaction from claiming B.

## 17. Inbox accounting invariant across interleavings

At all times:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
unallocated = inbox_balance - allocated_unclaimed
```

External deposit:

```text
inbox_balance increases
unallocated increases by same amount
```

Claim:

```text
inbox_balance decreases by x
allocated_unclaimed decreases by x
unallocated unchanged
```

Inbox allocation:

```text
allocated_unclaimed increases by unallocated
unallocated becomes zero
```

This makes deposits, allocations, and claims safe to serialize in any valid order under Solana account locking.

## 18. Allocation sequence semantics

`allocation_sequence` begins at `0`.

For a successful allocation:

```text
new_sequence = old_sequence + 1
```

The allocation commitment/event uses `new_sequence`, and that exact value is then persisted.

Claims do not change allocation sequence.

## 19. Direct nonce semantics

`direct_funding_nonce` begins at `0`.

A direct funding allocation must provide the exact current nonce. Success increments it once.

Plain inbox allocation and claims do not modify the direct nonce.

## 20. Pause-state interaction

Pause domains do not mutate agreement status or economics.

```text
agreements_paused -> gates propose/approve/supersession/activation flows
allocations_paused -> gates direct/inbox revenue allocation
claims_paused -> gates token claims
```

Guardian may only set pauses. Governance may pause/unpause under the authority policy.

No pause action may transfer tokens, edit shares, redirect payout wallets, or increment accounting.

## 21. Forbidden transitions/actions

The program rejects every equivalent of:

```text
Cancelled -> Proposed
Cancelled -> Active
Cancelled -> Superseded
Superseded -> Active
Superseded -> Cancelled
Active -> Proposed
Active -> Cancelled
Active -> Active with edited economic terms
Proposed -> Superseded
replacement activation without predecessor unanimous consent
manager changing participant payout wallet
participant changing another participant payout wallet
claim amount exceeding participant claimable balance
allocation that makes inbox balance smaller than allocated-unclaimed liability
```

## 22. Historical integrity

Every version keeps independent:

- cumulative gross allocated;
- per-participant cumulative allocations;
- per-participant cumulative claims;
- payout-routing revision history through events;
- direct funding nonce;
- allocation sequence;
- Royalty Inbox.

A newer version never migrates or rewrites the prior version's economic history.
