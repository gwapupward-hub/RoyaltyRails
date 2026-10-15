# RoyaltyRail Accounting Model v1

Status: canonical reference implementation  
Date: 2026-10-15

## Purpose

The TypeScript reference engine defines **economic allocation math only**. It does not perform token delivery and does not know about payout wallets, Solana token accounts, funding-path nonces, claims, or RPC execution.

This separation is intentional:

```text
revenue amount
    ↓
pure allocation engine
    ↓
participant entitlements
    ↓
protocol replay / funding controls
    ↓
independent token claims
```

Both direct funding and plain Royalty Inbox allocation use the same economic function. Replay protection exists only in the protocol path that needs it.

## Percentages

Shares are integer basis points:

- 10,000 BPS = 100%
- every executable agreement totals exactly 10,000 BPS
- V1 supports 1–16 participants
- all participant shares are positive

No floating-point arithmetic is permitted.

A single 100% participant is valid. This supports buyouts, full rights assignments, estate/entity consolidation, and standard routing after collaborators unanimously exit an older version.

## Why naive remainder assignment was rejected

A tempting design computes each participant's cumulative floored entitlement and gives the entire remainder to one fixed recipient. That recipient's cumulative target can later decrease by one base unit before its floored entitlement increases, implying a negative/clawback delta.

RoyaltyRail forbids negative allocation deltas.

## Bounded-error carry apportionment

For participant `i`:

```text
residual_before_i = gross * share_bps_i - allocated_i * 10_000
accrued_i         = residual_before_i + new_amount * share_bps_i
```

Whole base units due are allocated first:

```text
base_i = max(0, trunc(accrued_i / 10_000))
```

Any remaining indivisible units are assigned to participants with the highest residual score. Canonical participant order breaks exact ties.

After allocation:

```text
residual_after_i =
  new_gross * share_bps_i - new_allocated_i * 10_000
```

## Required allocation invariants

For every successful allocation:

1. `sum(current allocations) == new_amount`
2. every current allocation is `>= 0`
3. `sum(cumulative_allocated) == cumulative_gross`
4. for every participant, `abs(residual) < 10_000`
5. therefore lifetime proportional deviation is less than one settlement-asset base unit
6. identical canonical economic state + amount produces identical allocation output

For native Solana USDC, one base unit is one millionth of one USDC.

## Replay protection is not accounting math

Direct funding requires a protocol-level `direct_funding_nonce` because it both transfers tokens and allocates them.

Plain `allocate_inbox()` allocates funds that are already in the Royalty Inbox and MUST NOT consume or modify the direct-funding nonce.

Therefore the reference allocation engine intentionally has no nonce field or expected-nonce input.

Protocol implementation wraps the pure economic function:

```text
fund_and_allocate:
    verify direct nonce
    transfer USDC into inbox
    run canonical allocate(amount)
    increment direct nonce

allocate_inbox:
    compute currently unallocated inbox amount
    run canonical allocate(unallocated)
    do not touch direct nonce
```

This prevents funding-path replay rules from contaminating economic test vectors.

## Allocation is not claiming

The allocation engine answers:

> Of this newly allocated revenue, how much economically belongs to each participant?

It does not answer:

> Which wallet receives tokens right now?

On-chain claim state is tracked separately:

```text
claimable_i = cumulative_allocated_i - cumulative_claimed_i
```

Required claim invariant:

```text
0 <= cumulative_claimed_i <= cumulative_allocated_i
```

A payout-wallet rotation changes neither allocation history nor claimable amount.

## Royalty Inbox balance invariant

The protocol-level state must maintain:

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

The difference is revenue deposited into the Royalty Inbox but not yet economically allocated:

```text
unallocated = inbox_balance - allocated_unclaimed
```

Claims reduce inbox balance and allocated-unclaimed by the same amount, so they leave `unallocated` unchanged.

`allocate_inbox()` allocates exactly the positive `unallocated` balance.

### Claim amount width proof

An SPL Token account balance is represented as `u64`. The Royalty Inbox solvency invariant implies:

```text
sum(all participant claimable) <= inbox_balance <= u64::MAX
```

Therefore each individual participant's current `claimable` amount is also `<= u64::MAX` even though lifetime cumulative accounting uses `u128`.

A valid solvent v1 state cannot produce a current claim amount too large for an SPL Token transfer. No claim-chunking mechanism is needed.

## Partition behavior

Different deposit partitioning can change which participant receives a single indivisible rounding unit at an intermediate point. That is expected in discrete allocation systems.

RoyaltyRail's guarantee is **bounded lifetime proportional error**, not identical intermediate allocations for every possible deposit partition.

## Canonical implementation rule

The TypeScript allocation engine and JSON vectors are the v1 economic reference.

The Rust/Anchor allocation function must match:

- all canonical vectors;
- conservation properties;
- non-negative allocation behavior;
- residual bounds;
- 1–16 participant behavior.

Protocol-level direct nonce tests are separate Anchor/SDK tests.

Claim logic must not be allowed to alter or recompute percentage allocations.
