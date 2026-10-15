import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialState, settle, type Agreement } from "../src/index.js";

interface VectorFile {
  schemaVersion: number;
  denominatorBps: number;
  vectors: Array<{
    name: string;
    sharesBps: number[];
    deposits: string[];
    expectedPayouts: string[][];
    expectedFinalPaid: string[];
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

describe("canonical settlement vectors", () => {
  it("uses the expected schema", () => {
    expect(vectors.schemaVersion).toBe(1);
    expect(vectors.denominatorBps).toBe(10_000);
  });

  for (const vector of vectors.vectors) {
    it(vector.name, () => {
      const a = agreement(vector.sharesBps);
      let state = initialState(a);

      vector.deposits.forEach((rawDeposit, settlementIndex) => {
        const result = settle(a, state, {
          amount: BigInt(rawDeposit),
          expectedNonce: state.nextSettlementNonce,
        });

        const actual = a.participants.map(({ id }) => (result.payouts[id] ?? 0n).toString());
        expect(actual).toEqual(vector.expectedPayouts[settlementIndex]);
        state = result.nextState;
      });

      const finalPaid = a.participants.map(({ id }) => (state.paid[id] ?? 0n).toString());
      expect(finalPaid).toEqual(vector.expectedFinalPaid);
    });
  }
});
