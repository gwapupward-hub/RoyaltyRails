# RoyaltyRail Accounting Model v1

Status: Phase 1 reference implementation

## Purpose

The reference engine defines the economic behavior that the later Solana program must reproduce exactly. It contains no wallet, RPC, Anchor, or token-program dependency.

## Percentages

Shares are integer basis points:

- 10,000 BPS = 100%
- Every active agreement must total exactly 10,000 BPS
- V1 supports 2–16 recipients

## Why naive remainder assignment was rejected

A tempting approach is to compute each recipient's cumulative floored entitlement and give the full leftover remainder to one designated recipient. That is deterministic, but it is not monotonic: as cumulative gross increases, a previously assigned remainder unit can disappear before the recipient's floored entitlement increases. A subsequent settlement could therefore imply a negative payout delta.

RoyaltyRail forbids clawback-style negative settlement deltas in V1, so that design is rejected.

## Bounded-error carry apportionment

For recipient `i`:

```text
residual_before_i = gross * share_bps_i - paid_i * 10_000
accrued_i         = residual_before_i + deposit * share_bps_i
```

The engine pays every whole base unit currently due:

```text
base_i = max(0, floor(accrued_i / 10_000))
```

After base payouts, any remaining indivisible units are assigned to recipients with the highest residual score. Canonical participant order breaks exact ties.

The new implicit residual is:

```text
residual_after_i =
  new_gross * share_bps_i - new_paid_i * 10_000
```

## Required invariants

For every successful settlement:

1. `sum(payouts) == deposit`
2. every payout is `>= 0`
3. `sum(cumulative_paid) == cumulative_gross`
4. each participant satisfies `abs(residual) < 10_000`
5. therefore each participant's lifetime rounding deviation is less than one settlement-asset base unit
6. direct-settlement nonce increments exactly once
7. an already-used expected nonce cannot succeed again

## Partition behavior

Different deposit partitioning can change which participant receives a single indivisible rounding unit at a particular moment. That is expected in discrete settlement systems.

RoyaltyRail's V1 fairness guarantee is therefore **bounded lifetime error**, not a false promise that every possible partition of the same gross amount produces identical intermediate payouts.

For USDC, one base unit is one millionth of one USDC.

## Canonical implementation rule

The TypeScript engine is the Phase 1 economic reference. The later Rust implementation must match the canonical vectors and invariants before the Anchor program can pass its localnet gate.
