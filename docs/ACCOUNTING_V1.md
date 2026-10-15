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

RoyaltyRail v1 uses fixed integer share units rather than basis points:

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

Share precision and settlement-asset precision are separate. A percentage may be represented to six decimal places even when a small USDC payment cannot be divided to that granularity. Fractional entitlement is carried forward by cumulative accounting.

## Canonical participant order

Economic participants are identified by raw 32-byte participant authority.

Canonical order is:

```text
lexicographic ascending by raw 32-byte authority bytes
```

It is **not** Base58-string order, display-name order, insertion order, or database order.

The reference engine rejects duplicate, zero, malformed, or non-canonical authorities. Callers that accept unordered logical participants must first use the canonicalization helper and then preserve that order for:

- share vectors;
- cumulative allocation state;
- current allocation output;
- approval indexes;
- rounding tie-breaks;
- cross-language golden vectors.

`CumulativeState.allocated[i]` belongs to `agreement.participants[i]`.

This array-by-canonical-index contract removes ambiguity from map/object key order and ensures TypeScript, Rust, SDK, CLI, indexers, and third-party implementations resolve exact rounding ties identically.

## Why naive remainder assignment was rejected

A tempting design computes each participant's cumulative floored entitlement and gives the entire remainder to one fixed recipient. That recipient's cumulative target can later decrease by one asset base unit before its floored entitlement increases, implying a negative/clawback delta.

RoyaltyRail forbids negative allocation deltas.

## Bounded-error carry apportionment

Let:

```text
D = 100,000,000
```

Conceptually, the exact proportional residual numerator for participant `i` is:

```text
residual_i = gross * share_units_i - allocated_i * D
```

A valid RoyaltyRail state maintains:

```text
-D < residual_i < D
```

However, the implementation MUST NOT naively evaluate `gross * share_units` when `gross` spans the full `u128` state domain, because that intermediate can exceed `u128` even though the final proportional entitlement does not.

## Full-domain u128-safe entitlement decomposition

For:

```text
g = cumulative_gross
s = share_units
D = 100,000,000
```

write:

```text
q = g / D
t = g % D
```

Then:

```text
floor(g*s/D)
  = q*s + floor(t*s/D)
```

and:

```text
q*s <= g <= u128::MAX
t*s < D²
```

Therefore both terms fit in `u128` for every valid serializable `u128` cumulative gross.

Define:

```text
ideal_floor = q*s + floor(t*s/D)
remainder   = (t*s) % D
```

For a valid bounded-error cumulative state, `allocated` must be either:

```text
ideal_floor
```

or:

```text
ideal_floor + 1
```

subject to checked `u128` bounds.

The signed residual is reconstructed without a wide cumulative multiplication:

```text
if allocated == ideal_floor:
    residual = remainder
else if allocated == ideal_floor + 1:
    residual = remainder - D
else:
    reject malformed state
```

This formulation is the required Rust/TypeScript interoperability contract.

JavaScript `BigInt` is only a modeling type; it does **not** expand the valid RoyaltyRail numeric state domain beyond the Rust/on-chain widths.

## Current allocation step

For a new positive `u64` settlement amount `A`:

```text
accrued_i = residual_before_i + A * share_units_i
```

`A * share_units_i` fits comfortably within signed `i128` because:

```text
u64::MAX * 100,000,000 < 2^91
```

Whole asset base units are assigned first:

```text
base_i = max(0, trunc(accrued_i / D))
score_i = accrued_i - base_i*D
```

Then:

```text
remaining = A - sum(base_i)
```

must satisfy:

```text
0 <= remaining <= participant_count
```

Each of the `remaining` indivisible asset units is assigned once to the participant with the highest score, with canonical raw-authority order breaking exact ties.

Every addition to lifetime counters is checked against `u128::MAX`.

## Required allocation invariants

For every successful allocation:

1. `sum(current allocations) == new_amount`
2. every current allocation is `>= 0`
3. `sum(cumulative_allocated) == cumulative_gross`
4. every cumulative value is within `u128`
5. current input amount is within positive `u64`
6. for every participant, `abs(residual) < D`
7. lifetime proportional deviation is therefore less than one settlement-asset base unit
8. identical canonical economic state + amount produces identical allocation output
9. no successful allocation requires a negative/clawback delta

For native Solana USDC, one settlement-asset base unit is one millionth of one USDC.

## Numeric width contract

```text
share_units              u32
current token amount     u64
cumulative_gross         u128
cumulative_allocated_i   u128
cumulative_claimed_i     u128
allocation_sequence      u64
```

No wrapping arithmetic is allowed.

A state or transition outside these widths is invalid even if a language such as JavaScript could represent the larger integer.

## Replay protection is not accounting math

Direct funding requires protocol-level `direct_funding_nonce` because it transfers tokens and allocates them.

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

Different deposit partitioning can change which participant receives one indivisible USDC base unit at an intermediate point. This is expected in discrete allocation systems.

RoyaltyRail guarantees bounded lifetime proportional error, not partition-independent intermediate allocations.

## Conformance corpus

The V1 economic reference includes:

- explicit named boundary/regression vectors;
- a deterministic 100-case generated golden corpus committed by aggregate SHA-256;
- 10,000 randomized property runs in ordinary CI;
- 1–16 participant coverage;
- six-decimal share cases;
- minimum-share and extreme-skew cases;
- 16-way tie-breaking;
- `u64::MAX` current allocation;
- valid near-`u128::MAX` cumulative state;
- residual-boundary validation;
- long one-base-unit sequences.

The future Rust implementation MUST reproduce the same canonical vector transcript/digests byte-for-byte and satisfy the same invariants.

Nightly/fuzz workloads may be substantially larger, but they do not redefine canonical V1 semantics.

## Canonical implementation rule

The TypeScript economic reference, machine-readable constants, and immutable golden corpus define V1 accounting behavior.

Rust/Anchor allocation must match exactly:

- share scale `100,000,000`;
- raw-authority canonical order;
- `u64` current amount domain;
- `u128` cumulative state domain;
- quotient/remainder proportional-entitlement formulation;
- conservation;
- non-negative allocations;
- residual bounds;
- deterministic tie-breaking;
- 1–16 participant behavior.

Protocol-level replay, token, claim, and routing behavior is specified and tested separately.
