# RoyaltyRail Agreement State Machine v1

Status: Phase 2 specification freeze candidate  
Date: 2026-10-14

This document defines legal state transitions for `RevenuePool` and `AgreementVersion` accounts.

## 1. Agreement statuses

```text
Proposed
Active
Superseded
Cancelled
```

There is no mutable Draft state on-chain. Drafting is an off-chain Studio/API concern.

## 2. Allowed transitions

```text
             approve (no status change)
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
        │ newer unanimously-approved version activates
        ▼
 ┌────────────┐
 │ Superseded │
 └────────────┘
```

Terminal statuses:

```text
Superseded
Cancelled
```

`Active` is not terminal because it may later become `Superseded`.

Neither `Active` nor `Superseded` may transition to `Cancelled`.

## 3. Settlement eligibility by status

| Status | Direct settlement | Inbox settlement | New approval |
|---|---:|---:|---:|
| Proposed | No | No | Yes |
| Active | Yes | Yes | No |
| Superseded | Yes | Yes | No |
| Cancelled | No | No | No |

Superseded versions remain settleable for delayed/historical revenue that legitimately belongs to prior terms.

## 4. RevenuePool version pointers

Each pool stores:

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

There may be at most one pending version.

Version numbers are monotonically increasing and never reused.

## 5. Initial pool state

Immediately after `create_revenue_pool`:

```text
latest_version = 0
active_version = 0
pending_version = 0
```

No settlement is possible.

## 6. `propose_agreement`

Preconditions:

```text
agreements_paused == false
caller == pool.authority
pool.pending_version == 0
participant_count in 2..=16
sum(shares) == 10_000
participants strictly sorted by authority bytes
participant authorities unique
all shares > 0
```

Transition:

```text
new_version = pool.latest_version + 1
create AgreementVersion(status = Proposed)
pool.latest_version = new_version
pool.pending_version = new_version
```

No previously active version changes.

## 7. `approve_agreement`

Preconditions:

```text
agreements_paused == false
agreement.status == Proposed
pool.pending_version == agreement.version
signer matches one participant authority
expected_agreement_hash == agreement.agreement_hash
participant approval bit == 0
```

Transition:

```text
set participant approval bit = 1
```

Status remains `Proposed`.

Approving does not automatically activate. Activation is a separate instruction so callers and indexers have an explicit state transition and event.

## 8. `reject_agreement`

Preconditions:

```text
agreement.status == Proposed
pool.pending_version == agreement.version
signer matches one participant authority
expected_agreement_hash == agreement.agreement_hash
```

Transition:

```text
agreement.status = Cancelled
pool.pending_version = 0
```

Any prior approvals remain visible in historical state but can no longer lead to activation.

## 9. `cancel_agreement`

Preconditions:

```text
agreement.status == Proposed
pool.pending_version == agreement.version
caller == pool.authority
```

Transition:

```text
agreement.status = Cancelled
pool.pending_version = 0
```

The cancelled account remains on-chain and its version number is never reused.

## 10. `activate_initial_agreement`

Preconditions:

```text
agreements_paused == false
agreement.status == Proposed
pool.active_version == 0
pool.pending_version == agreement.version
approval_bitmap == required_approval_mask
```

Transition:

```text
agreement.status = Active
agreement.activated_slot = current_slot
pool.active_version = agreement.version
pool.pending_version = 0
```

Any caller may trigger activation after all participants approve.

## 11. `activate_next_version`

Preconditions:

```text
agreements_paused == false
new_agreement.status == Proposed
pool.active_version != 0
pool.pending_version == new_agreement.version
approval_bitmap == required_approval_mask
old_agreement.version == pool.active_version
old_agreement.status == Active
old_agreement.revenue_pool == pool.key
new_agreement.revenue_pool == pool.key
```

Atomic transition:

```text
old_agreement.status = Superseded
old_agreement.superseded_slot = current_slot
new_agreement.status = Active
new_agreement.activated_slot = current_slot
pool.active_version = new_agreement.version
pool.pending_version = 0
```

If any write/check fails, neither version changes.

## 12. No in-place economic mutation

Once an `AgreementVersion` is created, the following fields never change:

```text
revenue_pool
version
settlement_mint
token_program
terms_hash
agreement_hash
participants
```

Mutable fields are limited to lifecycle/accounting state:

```text
status
approval_bitmap
cumulative_gross
cumulative_paid
direct_settlement_nonce
settlement_sequence
activated_slot
superseded_slot
```

Economic changes require a new version.

## 13. Direct settlement transition

Preconditions:

```text
settlements_paused == false
agreement.status in {Active, Superseded}
amount > 0
expected_nonce == direct_settlement_nonce
all source/destination token accounts canonical
```

Atomic effects:

```text
transfer exact computed USDC payouts
cumulative_gross += amount
cumulative_paid[i] += payout[i]
direct_settlement_nonce += 1
settlement_sequence += 1
emit SettlementExecuted
```

A failed transfer or invariant check rolls the entire transaction back.

## 14. Inbox settlement transition

Preconditions:

```text
settlements_paused == false
agreement.status in {Active, Superseded}
royalty_inbox == canonical agreement-version inbox ATA
royalty_inbox.amount > 0
all destination ATAs canonical
```

Atomic effects:

```text
amount = full inbox balance
transfer exact computed USDC payouts
cumulative_gross += amount
cumulative_paid[i] += payout[i]
settlement_sequence += 1
emit SettlementExecuted
```

`direct_settlement_nonce` does not change.

## 15. Pause-state interaction

`agreements_paused` never changes an agreement's status by itself.

`settlements_paused` never changes an agreement's status by itself.

Pause flags only gate instructions.

No pause instruction may:

- mark an agreement cancelled;
- supersede an agreement;
- change participant terms;
- move Royalty Inbox funds;
- increment settlement accounting.

## 16. Forbidden transitions

The program MUST reject every path equivalent to:

```text
Cancelled -> Proposed
Cancelled -> Active
Cancelled -> Superseded
Superseded -> Active
Superseded -> Cancelled
Active -> Proposed
Active -> Cancelled
Active -> Active with edited terms
Proposed -> Superseded
```

A superseded version becoming economically relevant again requires a newly proposed agreement version, not status rollback.

## 17. Historical integrity

Every settlement is permanently associated with the exact `AgreementVersion` account that executed it.

Activation of a newer version does not migrate:

- cumulative gross;
- cumulative paid amounts;
- direct nonce;
- settlement sequence;
- Royalty Inbox balance;
- historical settlement attribution.

Every version maintains independent accounting for the funds settled under that version.
