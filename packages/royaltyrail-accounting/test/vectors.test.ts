import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allocate, initialState, type Agreement } from "../src/index.js";

interface VectorFile {
  schemaVersion: number;
  denominatorBps: number;
  vectors: Array<{
    name: string;
    sharesBps: number[];
    deposits: string[];
    expectedAllocations: string[][];
    expectedFinalAllocated: string[];
  }>;
}

const vectors = JSON.parse(
  readFileSync(new URL("../test-vectors/v1.json", import.meta.url), "utf8"),
) as VectorFile;

function agreement(sharesBps: number[]): Agreement {
  return {
    id: "RR-VECTOR",
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: sharesBps.map((shareBps, index) => ({ id: `p${index}`, shareBps })),
  };
}

describe("canonical allocation vectors", () => {
  it("uses the expected schema", () => {
    expect(vectors.schemaVersion).toBe(1);
    expect(vectors.denominatorBps).toBe(10_000);
  });

  for (const vector of vectors.vectors) {
    it(vector.name, () => {
      const a = agreement(vector.sharesBps);
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
