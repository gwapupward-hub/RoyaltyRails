import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TOTAL_SHARE_UNITS, allocate, initialState, type Agreement } from "../src/index.js";

interface VectorFile {
  schemaVersion: number;
  totalShareUnits: number;
  percentageDecimalPlaces: number;
  vectors: Array<{
    name: string;
    shares: number[];
    deposits: string[];
    expectedAllocations: string[][];
    expectedFinalAllocated: string[];
  }>;
}

const vectors = JSON.parse(
  readFileSync(new URL("../test-vectors/v1.json", import.meta.url), "utf8"),
) as VectorFile;

function agreement(shares: number[]): Agreement {
  return {
    id: "RR-VECTOR",
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: shares.map((shareUnits, index) => ({ id: `p${index}`, shareUnits })),
  };
}

describe("canonical allocation vectors", () => {
  it("uses the expected schema and share precision", () => {
    expect(vectors.schemaVersion).toBe(2);
    expect(vectors.totalShareUnits).toBe(TOTAL_SHARE_UNITS);
    expect(vectors.percentageDecimalPlaces).toBe(6);
  });

  for (const vector of vectors.vectors) {
    it(vector.name, () => {
      const a = agreement(vector.shares);
      let state = initialState(a);

      vector.deposits.forEach((rawDeposit, allocationIndex) => {
        const result = allocate(a, state, { amount: BigInt(rawDeposit) });

        const actual = a.participants.map(({ id }) =>
          (result.allocations[id] ?? 0n).toString(),
        );
        expect(actual).toEqual(vector.expectedAllocations[allocationIndex]);
        state = result.nextState;
      });

      const finalAllocated = a.participants.map(({ id }) =>
        (state.allocated[id] ?? 0n).toString(),
      );
      expect(finalAllocated).toEqual(vector.expectedFinalAllocated);
    });
  }
});
