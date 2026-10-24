import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ManifestError,
  canonicalize,
  canonicalizeRfc8785,
  parseManifestJson,
  serializeJcsNumber,
  termsHashHex,
  type JsonValue,
  type ManifestErrorCode,
} from "../src/index.js";

interface PositiveVector {
  name: string;
  description: string;
  input: string;
  canonical: string;
  sha256Hex: string;
  manifestRejects?: ManifestErrorCode;
}

interface NegativeVector {
  name: string;
  code: ManifestErrorCode;
  input?: string;
  inputHex?: string;
}

interface VectorFile {
  schemaVersion: number;
  positive: PositiveVector[];
  negative: NegativeVector[];
  rfc8785AppendixBNumbers: {
    vectors: { ieee754Hex: string; canonical: string }[];
    errors: string[];
  };
}

const vectors = JSON.parse(
  readFileSync(new URL("../test-vectors/v1.json", import.meta.url), "utf8"),
) as VectorFile;

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const fromIeee754Hex = (hex: string): number => Buffer.from(hex, "hex").readDoubleBE(0);

function negativeInput(vector: NegativeVector): Uint8Array {
  if (vector.inputHex !== undefined) return new Uint8Array(Buffer.from(vector.inputHex, "hex"));
  if (vector.input !== undefined) return utf8(vector.input);
  throw new Error(`vector ${vector.name} has no input`);
}

function rejectionCode(run: () => unknown): ManifestErrorCode | "accepted" {
  try {
    run();
    return "accepted";
  } catch (error) {
    if (error instanceof ManifestError) return error.code;
    throw error;
  }
}

describe("Agreement Manifest v1 vectors", () => {
  it("covers every rejection rule with at least one negative vector", () => {
    const covered = new Set(vectors.negative.map((vector) => vector.code));
    const rules: ManifestErrorCode[] = [
      "INVALID_UTF8",
      "BYTE_ORDER_MARK",
      "SYNTAX",
      "DUPLICATE_KEY",
      "LONE_SURROGATE",
      "NONCHARACTER",
      "NEGATIVE_ZERO",
      "NON_FINITE_NUMBER",
      "UNSAFE_INTEGER",
      "NOT_AN_OBJECT",
    ];
    for (const rule of rules) expect(covered.has(rule), rule).toBe(true);
  });

  for (const vector of vectors.positive) {
    const rejected = vector.manifestRejects;
    if (rejected !== undefined) {
      it(`matches RFC 8785 for ${vector.name} but rejects it as a manifest (${rejected})`, () => {
        expect(canonicalizeRfc8785(JSON.parse(vector.input) as JsonValue)).toBe(vector.canonical);
        expect(rejectionCode(() => termsHashHex(utf8(vector.input)))).toBe(rejected);
      });
      continue;
    }
    it(`canonicalizes and hashes ${vector.name}`, () => {
      expect(canonicalize(parseManifestJson(utf8(vector.input)))).toBe(vector.canonical);
      expect(canonicalizeRfc8785(parseManifestJson(utf8(vector.input)))).toBe(vector.canonical);
      expect(termsHashHex(utf8(vector.input))).toBe(vector.sha256Hex);
      // String input and canonical re-input give the same hash (JCS is idempotent).
      expect(termsHashHex(vector.input)).toBe(vector.sha256Hex);
      expect(termsHashHex(utf8(vector.canonical))).toBe(vector.sha256Hex);
    });
  }

  for (const vector of vectors.negative) {
    it(`rejects ${vector.name} with ${vector.code}`, () => {
      expect(rejectionCode(() => termsHashHex(negativeInput(vector)))).toBe(vector.code);
    });
  }
});

describe("RFC 8785 Appendix B number serialization", () => {
  for (const { ieee754Hex, canonical } of vectors.rfc8785AppendixBNumbers.vectors) {
    it(`serializes 0x${ieee754Hex} as ${canonical}`, () => {
      expect(serializeJcsNumber(fromIeee754Hex(ieee754Hex))).toBe(canonical);
    });
  }

  for (const hex of vectors.rfc8785AppendixBNumbers.errors) {
    it(`rejects non-finite 0x${hex}`, () => {
      expect(rejectionCode(() => serializeJcsNumber(fromIeee754Hex(hex)))).toBe("NON_FINITE_NUMBER");
    });
  }

  it("serializes IEEE negative zero as 0 at the JCS layer", () => {
    expect(serializeJcsNumber(-0)).toBe("0");
  });
});
