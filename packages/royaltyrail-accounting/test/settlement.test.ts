import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  AccountingError,
  TOTAL_SHARE_UNITS,
  U128_MAX,
  U64_MAX,
  allocate,
  canonicalizeParticipants,
  initialState,
  roundingResidual,
  validateAgreement,
  validateState,
  type Agreement,
  type Participant,
} from "../src/index.js";

function authority(value: number): Uint8Array {
  const out = new Uint8Array(32);
  out[31] = value;
  return out;
}

function agreement(shares: number[]): Agreement {
  return {
    id: "RR-TEST",
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: shares.map((shareUnits, index) => ({
      authority: authority(index + 1),
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
  const totalWeight = weights.reduce((left, right) => left + right, 0);
  const shares = weights.map(
    (weight) => 1 + Math.floor((distributable * weight) / totalWeight),
  );

  let remainder = TOTAL_SHARE_UNITS - shares.reduce((left, right) => left + right, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % shares.length) {
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }

  return shares;
}

describe("agreement validation", () => {
  it("requires exactly 100,000,000 share units", () => {
    expect(() => validateAgreement(agreement([50_000_000, 49_999_999]))).toThrow(
      AccountingError,
    );
    expect(() => validateAgreement(agreement([50_000_000, 50_000_001]))).toThrow(
      AccountingError,
    );
    expect(() => validateAgreement(agreement([50_000_000, 50_000_000]))).not.toThrow();
  });

  it("allows a single 100% participant", () => {
    expect(() => validateAgreement(agreement([TOTAL_SHARE_UNITS]))).not.toThrow();
  });

  it("supports six decimal places of percentage precision", () => {
    expect(() =>
      validateAgreement(agreement([33_333_333, 33_333_333, 33_333_334])),
    ).not.toThrow();
  });

  it("rejects non-canonical raw authority order", () => {
    const a = agreement([50_000_000, 50_000_000]);
    const invalid: Agreement = {
      ...a,
      participants: [...a.participants].reverse(),
    };

    expect(() => validateAgreement(invalid)).toThrow(/strictly sorted/);
  });

  it("rejects duplicate authorities", () => {
    const invalid: Agreement = {
      ...agreement([50_000_000, 50_000_000]),
      participants: [
        { authority: authority(1), shareUnits: 50_000_000 },
        { authority: authority(1), shareUnits: 50_000_000 },
      ],
    };

    expect(() => validateAgreement(invalid)).toThrow(/strictly sorted/);
  });

  it("rejects malformed and zero authorities", () => {
    expect(() =>
      validateAgreement({
        ...agreement([TOTAL_SHARE_UNITS]),
        participants: [{ authority: new Uint8Array(31), shareUnits: TOTAL_SHARE_UNITS }],
      }),
    ).toThrow(/32 bytes/);

    expect(() =>
      validateAgreement({
        ...agreement([TOTAL_SHARE_UNITS]),
        participants: [{ authority: new Uint8Array(32), shareUnits: TOTAL_SHARE_UNITS }],
      }),
    ).toThrow(/all-zero/);
  });

  it("rejects agreement versions outside u32", () => {
    const a = agreement([TOTAL_SHARE_UNITS]);
    expect(() => validateAgreement({ ...a, version: 0 })).toThrow(/u32/);
    expect(() => validateAgreement({ ...a, version: 0x1_0000_0000 })).toThrow(/u32/);
  });

  it("canonicalizes by raw authority bytes", () => {
    const shuffled: Participant[] = [
      { authority: authority(3), shareUnits: 20_000_000 },
      { authority: authority(1), shareUnits: 50_000_000 },
      { authority: authority(2), shareUnits: 30_000_000 },
    ];

    const canonical = canonicalizeParticipants(shuffled);
    expect(Array.from(canonical[0]?.authority ?? [])).toEqual(Array.from(authority(1)));
    expect(Array.from(canonical[1]?.authority ?? [])).toEqual(Array.from(authority(2)));
    expect(Array.from(canonical[2]?.authority ?? [])).toEqual(Array.from(authority(3)));
  });
});

describe("state validation", () => {
  it("accepts residuals at D-1 and -(D-1)", () => {
    const a = agreement([1, TOTAL_SHARE_UNITS - 1]);
    const gross = BigInt(TOTAL_SHARE_UNITS - 1);
    const state = { gross, allocated: [0n, gross] };

    expect(() => validateState(a, state)).not.toThrow();
    expect(roundingResidual(gross, 0n, 1)).toBe(BigInt(TOTAL_SHARE_UNITS - 1));
    expect(
      roundingResidual(gross, gross, TOTAL_SHARE_UNITS - 1),
    ).toBe(-BigInt(TOTAL_SHARE_UNITS - 1));
  });

  it("rejects a residual at the exact bound", () => {
    const a = agreement([1, TOTAL_SHARE_UNITS - 1]);
    const gross = BigInt(TOTAL_SHARE_UNITS);
    expect(() =>
      validateState(a, { gross, allocated: [0n, gross] }),
    ).toThrow(/residual/);
  });

  it("accepts a valid near-u128 state without wide multiplication", () => {
    const a = agreement([50_000_000, 50_000_000]);
    const state = {
      gross: U128_MAX,
      allocated: [(U128_MAX + 1n) / 2n, U128_MAX / 2n],
    };

    expect(() => validateState(a, state)).not.toThrow();
    expect(() => allocate(a, state, { amount: 1n })).toThrow(/u128/);
  });

  it("rejects wrong state vector length", () => {
    const a = agreement([50_000_000, 50_000_000]);
    expect(() =>
      validateState(a, { gross: 0n, allocated: [0n] }),
    ).toThrow(/length/);
  });
});

describe("allocation", () => {
  it("allocates a single-recipient deposit at 100%", () => {
    const a = agreement([TOTAL_SHARE_UNITS]);
    const result = allocate(a, initialState(a), { amount: 987_654n });

    expect(result.allocations).toEqual([987_654n]);
    expect(result.nextState.gross).toBe(987_654n);
  });

  it("supports the maximum SPL u64 allocation amount", () => {
    const a = agreement([TOTAL_SHARE_UNITS]);
    const result = allocate(a, initialState(a), { amount: U64_MAX });

    expect(result.allocations).toEqual([U64_MAX]);
    expect(result.nextState.gross).toBe(U64_MAX);
  });

  it("rejects allocation amounts above u64", () => {
    const a = agreement([TOTAL_SHARE_UNITS]);
    expect(() => allocate(a, initialState(a), { amount: U64_MAX + 1n })).toThrow(/u64/);
  });

  it("allocates an exact 70/20/10 deposit", () => {
    const a = agreement([70_000_000, 20_000_000, 10_000_000]);
    const result = allocate(a, initialState(a), { amount: 1_000_000n });

    expect(result.allocations).toEqual([700_000n, 200_000n, 100_000n]);
    expect(result.nextState.gross).toBe(1_000_000n);
  });

  it("handles the edge case that breaks fixed cumulative-remainder assignment", () => {
    const a = agreement([1, 49_999_999, 50_000_000]);
    const first = allocate(a, initialState(a), { amount: 50_000_001n });
    const second = allocate(a, first.nextState, { amount: 1n });

    expect(second.allocations.every((value) => value >= 0n)).toBe(true);
    expect(sum(second.allocations)).toBe(1n);
  });

  it("uses canonical authority order to break exact ties", () => {
    const a = agreement(Array<number>(16).fill(6_250_000));
    const result = allocate(a, initialState(a), { amount: 1n });

    expect(result.allocations[0]).toBe(1n);
    expect(result.allocations.slice(1).every((value) => value === 0n)).toBe(true);
  });

  it("handles the minimum share with a maximally skewed 16-participant agreement", () => {
    const shares = [...Array<number>(15).fill(1), TOTAL_SHARE_UNITS - 15];
    const a = agreement(shares);
    let state = initialState(a);

    for (let index = 0; index < 1_000; index += 1) {
      state = allocate(a, state, { amount: 1n }).nextState;
    }

    expect(sum(state.allocated)).toBe(1_000n);
    for (let index = 0; index < a.participants.length; index += 1) {
      const participant = a.participants[index];
      const allocated = state.allocated[index];
      if (participant === undefined || allocated === undefined) throw new Error("test mismatch");
      expect(abs(roundingResidual(state.gross, allocated, participant.shareUnits))).toBeLessThan(
        BigInt(TOTAL_SHARE_UNITS),
      );
    }
  });

  it("survives 100,000 one-base-unit deposits without invariant drift", () => {
    const a = agreement([33_333_333, 33_333_333, 33_333_334]);
    let state = initialState(a);

    for (let index = 0; index < 100_000; index += 1) {
      state = allocate(a, state, { amount: 1n }).nextState;
    }

    expect(sum(state.allocated)).toBe(100_000n);
    validateState(a, state);
  });
});

describe("property invariants", () => {
  it("conserves every allocation and bounds cumulative rounding error", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 16,
        }),
        fc.array(fc.integer({ min: 1, max: 10_000_000 }), {
          minLength: 1,
          maxLength: 40,
        }),
        (weights, amounts) => {
          const a = agreement(sharesFromWeights(weights));
          let state = initialState(a);

          for (const rawAmount of amounts) {
            const amount = BigInt(rawAmount);
            const result = allocate(a, state, { amount });

            expect(sum(result.allocations)).toBe(amount);
            expect(result.allocations.every((value) => value >= 0n)).toBe(true);
            state = result.nextState;
          }

          expect(sum(state.allocated)).toBe(state.gross);

          for (let index = 0; index < a.participants.length; index += 1) {
            const participant = a.participants[index];
            const allocated = state.allocated[index];
            if (participant === undefined || allocated === undefined) {
              throw new Error("property-test state mismatch");
            }
            expect(
              abs(roundingResidual(state.gross, allocated, participant.shareUnits)),
            ).toBeLessThan(BigInt(TOTAL_SHARE_UNITS));
          }
        },
      ),
      { numRuns: 10_000 },
    );
  });
});
