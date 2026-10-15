import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  AccountingError,
  TOTAL_SHARE_UNITS,
  allocate,
  initialState,
  validateAgreement,
  type Agreement,
} from "../src/index.js";

function agreement(shares: number[]): Agreement {
  return {
    id: "RR-TEST",
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: shares.map((shareUnits, index) => ({
      id: `p${index}`,
      shareUnits,
    })),
  };
}

function sum(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sharesFromWeights(weights: number[]): number[] {
  const minimum = weights.length;
  const distributable = TOTAL_SHARE_UNITS - minimum;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((weight) => 1 + Math.floor((distributable * weight) / totalWeight));

  let remainder = TOTAL_SHARE_UNITS - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % shares.length) {
    shares[i] = (shares[i] ?? 0) + 1;
    remainder -= 1;
  }

  return shares;
}

describe("agreement validation", () => {
  it("requires exactly 100,000,000 share units", () => {
    expect(() => validateAgreement(agreement([50_000_000, 49_999_999]))).toThrow(AccountingError);
    expect(() => validateAgreement(agreement([50_000_000, 50_000_001]))).toThrow(AccountingError);
    expect(() => validateAgreement(agreement([50_000_000, 50_000_000]))).not.toThrow();
  });

  it("allows a single 100% participant", () => {
    expect(() => validateAgreement(agreement([100_000_000]))).not.toThrow();
  });

  it("supports six decimal places of percentage precision", () => {
    expect(() =>
      validateAgreement(agreement([33_333_333, 33_333_333, 33_333_334])),
    ).not.toThrow();
  });

  it("rejects duplicate participant identifiers", () => {
    const invalid: Agreement = {
      ...agreement([50_000_000, 50_000_000]),
      participants: [
        { id: "same", shareUnits: 50_000_000 },
        { id: "same", shareUnits: 50_000_000 },
      ],
    };

    expect(() => validateAgreement(invalid)).toThrow("duplicate participant id");
  });
});

describe("allocation", () => {
  it("allocates a single-recipient deposit at 100%", () => {
    const a = agreement([100_000_000]);
    const result = allocate(a, initialState(a), { amount: 987_654n });

    expect(result.allocations).toEqual({ p0: 987_654n });
    expect(result.nextState.gross).toBe(987_654n);
  });

  it("allocates an exact 70/20/10 deposit", () => {
    const a = agreement([70_000_000, 20_000_000, 10_000_000]);
    const result = allocate(a, initialState(a), { amount: 1_000_000n });

    expect(result.allocations).toEqual({
      p0: 700_000n,
      p1: 200_000n,
      p2: 100_000n,
    });
    expect(result.nextState.gross).toBe(1_000_000n);
  });

  it("handles the edge case that breaks fixed cumulative-remainder assignment", () => {
    const a = agreement([1, 49_999_999, 50_000_000]);
    const first = allocate(a, initialState(a), { amount: 50_000_001n });
    const second = allocate(a, first.nextState, { amount: 1n });

    expect(Object.values(second.allocations).every((value) => value >= 0n)).toBe(true);
    expect(sum(Object.values(second.allocations))).toBe(1n);
  });

  it("never accumulates more than one asset base unit of lifetime allocation error", () => {
    const a = agreement([33_333_333, 33_333_333, 33_333_334]);
    let state = initialState(a);

    for (let i = 0; i < 10_001; i += 1) {
      state = allocate(a, state, { amount: 1n }).nextState;
    }

    for (const participant of a.participants) {
      const allocated = state.allocated[participant.id] ?? 0n;
      const residual =
        state.gross * BigInt(participant.shareUnits) - allocated * BigInt(TOTAL_SHARE_UNITS);
      expect(abs(residual)).toBeLessThan(BigInt(TOTAL_SHARE_UNITS));
    }
  });
});

describe("property invariants", () => {
  it("conserves every allocation and bounds cumulative rounding error", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000 }), { minLength: 1, maxLength: 16 }),
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 40 }),
        (weights, amounts) => {
          const a = agreement(sharesFromWeights(weights));
          let state = initialState(a);

          for (const rawAmount of amounts) {
            const amount = BigInt(rawAmount);
            const result = allocate(a, state, { amount });

            expect(sum(Object.values(result.allocations))).toBe(amount);
            expect(Object.values(result.allocations).every((value) => value >= 0n)).toBe(true);
            state = result.nextState;
          }

          expect(sum(Object.values(state.allocated))).toBe(state.gross);

          for (const participant of a.participants) {
            const allocated = state.allocated[participant.id] ?? 0n;
            const residual =
              state.gross * BigInt(participant.shareUnits) - allocated * BigInt(TOTAL_SHARE_UNITS);
            expect(abs(residual)).toBeLessThan(BigInt(TOTAL_SHARE_UNITS));
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
