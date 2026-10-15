import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  AccountingError,
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
    participants: shares.map((shareBps, index) => ({
      id: `p${index}`,
      shareBps,
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
  const distributable = 10_000 - minimum;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((weight) => 1 + Math.floor((distributable * weight) / totalWeight));

  let remainder = 10_000 - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % shares.length) {
    shares[i] = (shares[i] ?? 0) + 1;
    remainder -= 1;
  }

  return shares;
}

describe("agreement validation", () => {
  it("requires exactly 10,000 BPS", () => {
    expect(() => validateAgreement(agreement([5_000, 4_999]))).toThrow(AccountingError);
    expect(() => validateAgreement(agreement([5_000, 5_001]))).toThrow(AccountingError);
    expect(() => validateAgreement(agreement([5_000, 5_000]))).not.toThrow();
  });

  it("allows a single 100% participant", () => {
    expect(() => validateAgreement(agreement([10_000]))).not.toThrow();
  });

  it("rejects duplicate participant identifiers", () => {
    const invalid: Agreement = {
      ...agreement([5_000, 5_000]),
      participants: [
        { id: "same", shareBps: 5_000 },
        { id: "same", shareBps: 5_000 },
      ],
    };

    expect(() => validateAgreement(invalid)).toThrow("duplicate participant id");
  });
});

describe("allocation", () => {
  it("allocates a single-recipient deposit at 100%", () => {
    const a = agreement([10_000]);
    const result = allocate(a, initialState(a), {
      amount: 987_654n,
      expectedNonce: 0n,
    });

    expect(result.allocations).toEqual({ p0: 987_654n });
    expect(result.nextState.gross).toBe(987_654n);
  });

  it("allocates an exact 70/20/10 deposit", () => {
    const a = agreement([7_000, 2_000, 1_000]);
    const result = allocate(a, initialState(a), {
      amount: 1_000_000n,
      expectedNonce: 0n,
    });

    expect(result.allocations).toEqual({
      p0: 700_000n,
      p1: 200_000n,
      p2: 100_000n,
    });
    expect(result.nextState.gross).toBe(1_000_000n);
    expect(result.nextState.nextDirectNonce).toBe(1n);
  });

  it("rejects direct nonce replay", () => {
    const a = agreement([5_000, 5_000]);
    const first = allocate(a, initialState(a), { amount: 100n, expectedNonce: 0n });

    expect(() =>
      allocate(a, first.nextState, { amount: 100n, expectedNonce: 0n }),
    ).toThrow("direct allocation nonce mismatch");
  });

  it("handles the edge case that breaks fixed cumulative-remainder assignment", () => {
    const a = agreement([1, 4_999, 5_000]);
    const first = allocate(a, initialState(a), { amount: 5_001n, expectedNonce: 0n });
    const second = allocate(a, first.nextState, { amount: 1n, expectedNonce: 1n });

    expect(Object.values(second.allocations).every((value) => value >= 0n)).toBe(true);
    expect(sum(Object.values(second.allocations))).toBe(1n);
  });

  it("never accumulates more than one base unit of lifetime allocation error", () => {
    const a = agreement([3_333, 3_333, 3_334]);
    let state = initialState(a);

    for (let i = 0; i < 10_001; i += 1) {
      state = allocate(a, state, {
        amount: 1n,
        expectedNonce: state.nextDirectNonce,
      }).nextState;
    }

    for (const participant of a.participants) {
      const allocated = state.allocated[participant.id] ?? 0n;
      const residual = state.gross * BigInt(participant.shareBps) - allocated * 10_000n;
      expect(abs(residual)).toBeLessThan(10_000n);
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
            const result = allocate(a, state, {
              amount,
              expectedNonce: state.nextDirectNonce,
            });

            expect(sum(Object.values(result.allocations))).toBe(amount);
            expect(Object.values(result.allocations).every((value) => value >= 0n)).toBe(true);
            state = result.nextState;
          }

          expect(sum(Object.values(state.allocated))).toBe(state.gross);

          for (const participant of a.participants) {
            const allocated = state.allocated[participant.id] ?? 0n;
            const residual = state.gross * BigInt(participant.shareBps) - allocated * 10_000n;
            expect(abs(residual)).toBeLessThan(10_000n);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
