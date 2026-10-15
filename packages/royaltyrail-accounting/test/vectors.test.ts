import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TOTAL_SHARE_UNITS,
  allocate,
  validateState,
  type Agreement,
  type CumulativeState,
} from "../src/index.js";

interface GoldenVector {
  name: string;
  shares: number[];
  initialGross: string;
  initialAllocated: string[];
  deposits: string[];
  expectedDigest: string;
}

interface VectorFile {
  schemaVersion: number;
  totalShareUnits: number;
  percentageDecimalPlaces: number;
  authorityScheme: string;
  digestDomain: string;
  generatedCorpus: {
    algorithm: string;
    seed: number;
    count: number;
    expectedCorpusDigest: string;
  };
  namedVectors: GoldenVector[];
}

const vectors = JSON.parse(
  readFileSync(new URL("../test-vectors/v1.json", import.meta.url), "utf8"),
) as VectorFile;

function authority(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 1 || value > 255) {
    throw new Error("test authority index outside one-byte corpus domain");
  }
  const out = new Uint8Array(32);
  out[31] = value;
  return out;
}

function agreement(name: string, shares: readonly number[]): Agreement {
  return {
    id: `RR-VECTOR-${name}`,
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: shares.map((shareUnits, index) => ({
      authority: authority(index + 1),
      shareUnits,
    })),
  };
}

function encodeUnsignedLe(value: bigint, width: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(width * 8)) {
    throw new Error(`value does not fit in ${width} bytes`);
  }

  const out = new Uint8Array(width);
  let remaining = value;
  for (let index = 0; index < width; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function vectorDigest(
  name: string,
  shares: readonly number[],
  initialState: CumulativeState,
  deposits: readonly bigint[],
): string {
  const a = agreement(name, shares);
  validateState(a, initialState);

  const hash = createHash("sha256");
  hash.update(vectors.digestDomain, "utf8");
  hash.update(new Uint8Array([shares.length]));
  hash.update(encodeUnsignedLe(initialState.gross, 16));
  for (const allocated of initialState.allocated) {
    hash.update(encodeUnsignedLe(allocated, 16));
  }

  let state = initialState;
  for (const deposit of deposits) {
    const result = allocate(a, state, { amount: deposit });
    hash.update(encodeUnsignedLe(deposit, 8));
    for (const allocation of result.allocations) {
      hash.update(encodeUnsignedLe(allocation, 8));
    }
    state = result.nextState;
  }

  validateState(a, state);
  hash.update(encodeUnsignedLe(state.gross, 16));
  for (const allocated of state.allocated) {
    hash.update(encodeUnsignedLe(allocated, 16));
  }

  return hash.digest("hex");
}

function xorshift32(state: number): number {
  let value = state >>> 0;
  value ^= (value << 13) >>> 0;
  value ^= value >>> 17;
  value ^= (value << 5) >>> 0;
  return value >>> 0;
}

function generatedCase(state: number): {
  nextState: number;
  shares: number[];
  deposits: bigint[];
} {
  let next = xorshift32(state);
  const participantCount = 1 + (next % 16);
  let shares: number[];

  if (participantCount === 1) {
    shares = [TOTAL_SHARE_UNITS];
  } else {
    const weights: number[] = [];
    for (let index = 0; index < participantCount; index += 1) {
      next = xorshift32(next);
      weights.push(1 + (next % 1_000_000));
    }

    const distributable = TOTAL_SHARE_UNITS - participantCount;
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    shares = weights.map(
      (weight) => 1 + Math.floor((distributable * weight) / totalWeight),
    );

    let remainder = TOTAL_SHARE_UNITS - shares.reduce((sum, share) => sum + share, 0);
    for (let index = 0; remainder > 0; index = (index + 1) % shares.length) {
      shares[index] = (shares[index] ?? 0) + 1;
      remainder -= 1;
    }
  }

  next = xorshift32(next);
  const depositCount = 1 + (next % 20);
  const deposits: bigint[] = [];
  for (let index = 0; index < depositCount; index += 1) {
    next = xorshift32(next);
    deposits.push(BigInt(1 + (next % 1_000_000_000)));
  }

  return { nextState: next, shares, deposits };
}

describe("canonical allocation golden corpus", () => {
  it("uses the expected immutable corpus contract", () => {
    expect(vectors.schemaVersion).toBe(6);
    expect(vectors.totalShareUnits).toBe(TOTAL_SHARE_UNITS);
    expect(vectors.percentageDecimalPlaces).toBe(6);
    expect(vectors.authorityScheme).toBe("sequential-u256-big-endian-from-1");
    expect(vectors.generatedCorpus.algorithm).toBe("xorshift32-v1");
    expect(vectors.generatedCorpus.count).toBeGreaterThanOrEqual(100);
  });

  for (const vector of vectors.namedVectors) {
    it(`named vector: ${vector.name}`, () => {
      const state: CumulativeState = {
        gross: BigInt(vector.initialGross),
        allocated: vector.initialAllocated.map(BigInt),
      };
      const digest = vectorDigest(
        vector.name,
        vector.shares,
        state,
        vector.deposits.map(BigInt),
      );
      expect(digest).toBe(vector.expectedDigest);
    });
  }

  it("matches the immutable 100-case generated corpus digest", () => {
    const corpusHash = createHash("sha256");
    let state = vectors.generatedCorpus.seed >>> 0;

    for (let index = 0; index < vectors.generatedCorpus.count; index += 1) {
      const generated = generatedCase(state);
      state = generated.nextState;

      const digest = vectorDigest(
        `generated-${index.toString().padStart(3, "0")}`,
        generated.shares,
        { gross: 0n, allocated: generated.shares.map(() => 0n) },
        generated.deposits,
      );
      corpusHash.update(Buffer.from(digest, "hex"));
    }

    expect(corpusHash.digest("hex")).toBe(vectors.generatedCorpus.expectedCorpusDigest);
  });
});
