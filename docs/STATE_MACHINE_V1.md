# RoyaltyRail Agreement State Machine v1

Status: Phase 2 hardened freeze candidate  
Date: 2026-10-15

## 1. Agreement statuses

```text
Proposed
Active
Superseded
Cancelled
```

No mutable on-chain Draft exists. Drafting/invitation is an off-chain Studio/API concern.

Legal status transitions:

```text
Proposed -> Active
Proposed -> Cancelled
Active -> Superseded
```

Cancelled and Superseded are terminal status states. Superseded versions remain eligible for delayed/historical allocations and outstanding claims.

## 2. RevenuePool version pointers

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

At most one pending version exists. Version numbers monotonically increase and are never reused.

## 3. Proposal creation

Initial:

```text
predecessor_version = 0
pool.active_version = 0
```

Replacement:

```text
predecessor_version = pool.active_version
pool.active_version != 0
```

Preconditions:

```text
agreements_paused == false
caller == pool.manager_authority
pool.pending_version == 0
participant_count in 1..=16
sum(share_units) == 100_000_000
share_units > 0
participant authorities strictly sorted + unique
```

Effects:

```text
new_version = latest_version + 1
create AgreementVersion(Proposed)
latest_version = new_version
pending_version = new_version
```

Participant payout wallets begin unset and are selected by participants during approval.

## 4. Proposed participant approval

Instruction concept:

```text
approve_agreement(expected_hash, payout_wallet)
```

Preconditions:

```text
agreements_paused == false
status == Proposed
pool.pending_version == agreement.version
signer matches proposed participant authority
expected_hash == stored agreement_hash
participant approval bit == 0
payout_wallet != default pubkey
```

Effects:

```text
participant.payout_wallet = selected wallet
participant.payout_revision = 1
set proposed approval bit
emit ParticipantApproved
```

## 5. Predecessor supersession consent

For a replacement, every participant in the current Active predecessor must consent to replacement by the exact proposed hash.

Preconditions:

```text
new.status == Proposed
new.predecessor_version != 0
old.version == new.predecessor_version
old.version == pool.active_version
old.status == Active
signer is an old participant authority
expected_new_hash == new.agreement_hash
supersession bit == 0
```

Effect:

```text
set supersession bit in new AgreementVersion
```

Bits map to predecessor canonical participant order.

A continuing participant may approve new terms and predecessor supersession in one transaction containing two RoyaltyRail instructions.

## 6. Rejection / cancellation

A Proposed version may be rejected by:

- any proposed participant; or
- any current predecessor participant for a replacement.

Manager may also cancel a Proposed version.

Effects:

```text
agreement.status = Cancelled
pool.pending_version = 0
```

Cancelled version numbers are never reused. Current Active agreement remains unchanged.

## 7. Initial activation

Preconditions:

```text
agreements_paused == false
new.status == Proposed
new.predecessor_version == 0
pool.active_version == 0
pool.pending_version == new.version
new approval mask complete
all payout wallets initialized
```

Effects:

```text
new.status = Active
new.activated_slot = current_slot
pool.active_version = new.version
pool.pending_version = 0
```

Any caller may trigger activation after consent is complete.

## 8. Replacement activation

Preconditions:

```text
agreements_paused == false
new.status == Proposed
old.status == Active
new.predecessor_version == old.version
old.version == pool.active_version
new.version == pool.pending_version
new approval mask complete
new supersession mask complete for old participant count
all new payout wallets initialized
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

A removed participant cannot be omitted from the consent set.

## 9. Approval mask rule

For `n` participants:

```text
if n == 16:
    required_mask = u16::MAX
else:
    required_mask = (1u16 << n) - 1
```

This rule applies independently to new-participant approval and predecessor supersession consent.

For a one-participant version, required mask is `0b1`.

## 10. Economic immutability

After proposal, these never change:

```text
revenue_pool
version
predecessor_version
settlement_mint
token_program
terms_hash
agreement_hash
participant_authority
share_units
```

Creative roles/credits are represented in the hashed Agreement Manifest, not as mutable or singular on-chain participant fields.

Mutable fields are limited to lifecycle/approval, payout routing, allocation/claim accounting, nonce/sequence counters and timestamps.

## 11. Payout-wallet rotation

```text
update_payout_wallet(new_wallet)
```

Preconditions:

```text
status in {Proposed, Active, Superseded}
signer == participant authority
new wallet != default pubkey
new wallet != current wallet
```

Effects:

```text
payout_wallet = new wallet
payout_revision += 1
emit PayoutWalletUpdated
```

No other participant signature is required because economics are unchanged.

## 12. Allocation eligibility

```text
status in {Active, Superseded}
allocations_paused == false
settlement mint/token program match config
```

Proposed/Cancelled versions cannot allocate through RoyaltyRail.

## 13. Direct funding + allocation

Preconditions:

```text
agreement eligible for allocation
amount > 0
expected_nonce == direct_funding_nonce
payer source mint == configured settlement mint
payer source token authority == payer signer
Royalty Inbox canonical
```

Atomic effects:

```text
transfer amount payer source -> Royalty Inbox
run pure canonical allocate(amount)
cumulative_gross += amount
participant.cumulative_allocated += returned allocations
direct_funding_nonce += 1
allocation_sequence += 1
emit RevenueAllocated(DirectFunding)
```

The pure allocation function itself has no replay nonce.

## 14. Plain inbox allocation

Define:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
unallocated = inbox_balance - allocated_unclaimed
```

Preconditions:

```text
agreement eligible for allocation
Royalty Inbox canonical
inbox_balance >= allocated_unclaimed
unallocated > 0
```

Effects:

```text
run pure canonical allocate(unallocated)
cumulative_gross += unallocated
participant.cumulative_allocated += returned allocations
allocation_sequence += 1
direct_funding_nonce unchanged
emit RevenueAllocated(Inbox)
```

No token leaves the inbox during allocation.

## 15. Claim transition

```text
claim_participant(index)
```

Permissionless to trigger.

Preconditions:

```text
status in {Active, Superseded}
claims_paused == false
participant index valid
claimable = cumulative_allocated - cumulative_claimed
claimable > 0
Royalty Inbox canonical
payout ATA == canonical ATA for current payout wallet + settlement mint
inbox_balance >= claimable
```

The vault-solvency invariant plus the SPL token account's `u64` balance representation guarantees current claimable fits the transfer amount type.

Atomic effects:

```text
transfer claimable Royalty Inbox -> participant payout ATA
participant.cumulative_claimed += claimable
emit PayoutClaimed
```

A failure for participant A leaves all state unchanged for that transaction and cannot prevent an independent transaction from claiming participant B.

## 16. Inbox invariant across interleavings

At all times:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
unallocated = inbox_balance - allocated_unclaimed
```

External deposit:

```text
inbox_balance += x
unallocated += x
```

Claim:

```text
inbox_balance -= x
allocated_unclaimed -= x
unallocated unchanged
```

Inbox allocation:

```text
allocated_unclaimed += unallocated
unallocated -> 0
```

This supports arbitrary valid serializations of deposit/allocation/claim instructions.

## 17. Allocation sequence

Starts at `0`.

Successful allocation:

```text
new_sequence = old_sequence + 1
```

Commitment/event uses `new_sequence`, and that exact value is persisted.

Claims do not modify allocation sequence.

## 18. Direct funding nonce

Starts at `0`.

Only `fund_and_allocate` reads/increments it.

```text
expected_nonce must equal current nonce
success -> nonce + 1
```

`allocate_inbox` and claims never modify direct nonce.

## 19. Management transfer

Work/Pool manager transfer:

```text
propose_manager(new_manager)
accept_manager()
```

Current manager proposes, new manager signs acceptance.

Management transfer never alters economic terms or participant routing.

## 20. Pause interaction

```text
agreements_paused -> proposal/approval/supersession/activation flows
allocations_paused -> direct/inbox allocation
claims_paused -> claims
```

Guardian can pause; governance can pause/unpause under the configured authority model.

Pause changes no balances, shares or destinations.

## 21. Forbidden transitions/actions

Reject every equivalent of:

```text
Cancelled -> Proposed/Active/Superseded
Superseded -> Active/Cancelled
Active -> Proposed/Cancelled
Active -> Active with edited economics
Proposed -> Superseded
replacement activation without predecessor unanimous consent
manager changing participant payout wallet
participant changing another participant payout wallet
claim exceeding claimable amount
allocation violating inbox solvency
inbox allocation consuming direct funding nonce
```

## 22. Historical integrity

Every version preserves independent agreement/terms hashes, cumulative gross allocation, per-participant allocations/claims, routing-revision history via events, direct funding nonce, allocation sequence, and Royalty Inbox.

A later version never rewrites the predecessor's history.
