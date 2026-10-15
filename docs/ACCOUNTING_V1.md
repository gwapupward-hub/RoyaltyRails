# RoyaltyRail Accounting Model v1

Status: canonical reference implementation  
Date: 2026-10-15

## Purpose

The TypeScript reference engine defines **economic allocation math only**. It does not perform token delivery and does not know about payout wallets, Solana token accounts, funding-path nonces, claims, or RPC execution.

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

Both direct funding and Royalty Inbox allocation use the same economic function. Replay protection exists only in the protocol path that needs it.

## Share precision

RoyaltyRail v1 does **not** use basis points as its canonical on-chain percentage representation.

Music-rights systems can require fractional percentages substantially finer than 0.01%. RoyaltyRail therefore uses a fixed share scale supporting six decimal places in percentage representation:

```text
TOTAL_SHARE_UNITS = 100,000,000
```

Examples:

```text
100%       = 100,000,000 share units
50%        =  50,000,000 share units
5%         =   5,000,000 share units
21.75%     =  21,750,000 share units
33.333333% =  33,333,333 share units
0.000001%  =           1 share unit
```

Properties:

- every executable agreement totals exactly `100,000,000` share units;
- V1 supports 1–16 participants;
- every participant share is a positive integer;
- the canonical on-chain share field is `u32`;
- UI may display ordinary percentages but MUST convert losslessly to/from canonical share units;
- no floating-point arithmetic is permitted in economic calculations.

This precision aligns with current music-rights data conventions that may communicate percentages with up to six digits after the decimal point.

A single 100% participant is valid.

## Why naive remainder assignment was rejected

A tempting design computes each participant's cumulative floored entitlement and gives the entire remainder to one fixed recipient. That recipient's cumulative target can later decrease by one asset base unit before its floored entitlement increases, implying a negative/clawback delta.

RoyaltyRail forbids negative allocation deltas.

## Bounded-error carry apportionment

Let:

```text
D = 100,000,000
```

For participant `i`:

```text
residual_before_i = gross * share_units_i - allocated_i * D
accrued_i         = residual_before_i + new_amount * share_units_i
```

Whole settlement-asset base units due are allocated first:

```text
base_i = max(0, trunc(accrued_i / D))
```

Any remaining indivisible asset units are assigned to participants with the highest residual score. Canonical participant order breaks exact ties.

After allocation:

```text
residual_after_i =
  new_gross * share_units_i - new_allocated_i * D
```

## Required allocation invariants

For every successful allocation:

1. `sum(current allocations) == new_amount`
2. every current allocation is `>= 0`
3. `sum(cumulative_allocated) == cumulative_gross`
4. for every participant, `abs(residual) < D`
5. therefore lifetime proportional deviation is less than one settlement-asset base unit
6. identical canonical economic state + amount produces identical allocation output

For native Solana USDC, one asset base unit is one millionth of one USDC.

Share precision and asset precision are separate concepts: a share may be represented with six decimal places of **percentage** precision even when a particular small USDC deposit cannot be physically divided that finely. The bounded-error allocator carries that fractional entitlement forward across future allocations.

## Numeric width

Actual transfer amounts are `u64` because SPL Token balances/amounts are `u64`.

Lifetime accounting uses `u128`.

Allocation intermediates must use checked `u128` arithmetic. The maximum v1 share scale (`100,000,000`) multiplied by a `u64` allocation amount remains comfortably within `u128`.

No wrapping arithmetic is allowed.

## Replay protection is not accounting math

Direct funding requires protocol-level `direct_funding_nonce` because it both transfers tokens and allocates them.

Plain `allocate_inbox()` allocates funds already in the Royalty Inbox and MUST NOT consume or modify the direct-funding nonce.

The reference engine intentionally has no nonce field or expected-nonce input.

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

Payout-wallet rotation changes neither allocation history nor claimable amount.

## Royalty Inbox balance invariant

```text
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

Unallocated revenue:

```text
unallocated = inbox_balance - allocated_unclaimed
```

Claims reduce inbox balance and allocated-unclaimed equally, leaving `unallocated` unchanged.

`allocate_inbox()` allocates exactly the positive `unallocated` balance.

### Claim amount width proof

An SPL Token account balance is `u64`.

```text
sum(all participant claimable) <= inbox_balance <= u64::MAX
```

Therefore every individual current claim also fits `u64`, even though lifetime accounting uses `u128`.

## Partition behavior

Different deposit partitioning can change which participant receives a single indivisible USDC base unit at an intermediate point. That is expected in discrete allocation systems.

RoyaltyRail guarantees bounded lifetime proportional error, not identical intermediate allocations for every possible deposit partition.

## Canonical implementation rule

The TypeScript allocation engine and canonical JSON vectors are the v1 economic reference.

Rust/Anchor allocation must match:

- canonical vectors;
- share scale `100,000,000`;
- conservation;
- non-negative allocations;
- residual bounds;
- 1–16 participant behavior;
- six-decimal percentage-share cases.

Protocol-level replay/claim behavior is tested separately.
