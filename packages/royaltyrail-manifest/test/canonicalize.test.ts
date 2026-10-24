import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ManifestError,
  canonicalize,
  parseManifestJson,
  termsHashHex,
  type JsonValue,
  type ManifestErrorCode,
} from "../src/index.js";

function rejectionCode(run: () => unknown): ManifestErrorCode | "accepted" {
  try {
    run();
    return "accepted";
  } catch (error) {
    if (error instanceof ManifestError) return error.code;
    throw error;
  }
}

describe("canonicalize on in-memory values", () => {
  it("applies the same I-JSON rules as the parser", () => {
    expect(rejectionCode(() => canonicalize({ a: -0 }))).toBe("NEGATIVE_ZERO");
    expect(rejectionCode(() => canonicalize({ a: Number.NaN }))).toBe("NON_FINITE_NUMBER");
    expect(rejectionCode(() => canonicalize({ a: Number.POSITIVE_INFINITY }))).toBe("NON_FINITE_NUMBER");
    expect(rejectionCode(() => canonicalize({ a: 2 ** 53 }))).toBe("UNSAFE_INTEGER");
    expect(rejectionCode(() => canonicalize({ a: "\ud800" }))).toBe("LONE_SURROGATE");
    expect(rejectionCode(() => canonicalize({ "￿": 1 }))).toBe("NONCHARACTER");
  });

  it("rejects values JSON cannot represent", () => {
    const cases: unknown[] = [
      { a: undefined },
      { a: 1n },
      { a: () => 1 },
      { a: new Date(0) },
      { a: new Map() },
    ];
    for (const value of cases) {
      expect(rejectionCode(() => canonicalize(value as JsonValue))).toBe("UNSUPPORTED_VALUE");
    }
  });

  it("does not let a __proto__ key change the parsed object's prototype", () => {
    const parsed = parseManifestJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(null);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(canonicalize(parsed as JsonValue)).toBe('{"__proto__":{"polluted":true}}');
  });
});

const safeJson: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }).filter((n) => !Object.is(n, -0)),
    fc.double({ noNaN: true, noDefaultInfinity: true }).filter(
      (n) => !Object.is(n, -0) && (!Number.isInteger(n) || Number.isSafeInteger(n)),
    ),
    fc.string({ unit: "grapheme" }),
    fc.array(tie("value"), { maxLength: 5 }),
    fc.dictionary(fc.string({ unit: "grapheme" }), tie("value"), { maxKeys: 5 }),
  ),
})).value;

describe("canonicalization properties", () => {
  it("round-trips: parse(JCS(x)) canonicalizes to the same bytes", () => {
    fc.assert(
      fc.property(safeJson, (value) => {
        const canonical = canonicalize(value);
        expect(canonicalize(parseManifestJson(canonical))).toBe(canonical);
        expect(JSON.parse(canonical)).toEqual(JSON.parse(JSON.stringify(value)));
      }),
      { numRuns: 500 },
    );
  });

  it("is independent of key insertion order and whitespace", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ unit: "grapheme" }), fc.integer(), { minKeys: 1, maxKeys: 8 }),
        (record) => {
          const forward = `{ ${Object.entries(record).map(([k, v]) => `${JSON.stringify(k)} : ${v}`).join(" ,\n ")} }`;
          const reversed = JSON.stringify(Object.fromEntries(Object.entries(record).reverse()));
          expect(termsHashHex(forward)).toBe(termsHashHex(reversed));
        },
      ),
      { numRuns: 300 },
    );
  });
});
