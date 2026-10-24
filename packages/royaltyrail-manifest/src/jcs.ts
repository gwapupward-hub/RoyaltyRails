import { createHash } from "node:crypto";

import { assertIJsonNumber, assertIJsonString } from "./ijson.js";
import { parseManifestJson } from "./parse.js";
import { ManifestError, type JsonObject, type JsonValue } from "./types.js";

/**
 * RFC 8785 §3.2.2.3: numbers serialize exactly as ECMAScript
 * Number.prototype.toString, which JSON.stringify uses for finite numbers.
 * Only non-finite values are rejected here, so the RFC's Appendix B vectors
 * can be checked directly; manifest-level rules live in assertIJsonNumber.
 */
export function serializeJcsNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ManifestError("NON_FINITE_NUMBER", "JCS cannot serialize NaN or Infinity");
  }
  return JSON.stringify(value);
}

/**
 * RFC 8785 §3.2.2.2: strings serialize as ECMAScript JSON.stringify does
 * (\b \t \n \f \r \" \\, other controls as lowercase \u00xx, everything else
 * literal). Lone surrogates and noncharacters are rejected first.
 */
function serializeString(value: string, where: string): string {
  assertIJsonString(value, where);
  return JSON.stringify(value);
}

/** RFC 8785 §3.2.3: sort keys by their UTF-16 code units. */
function compareUtf16(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * `manifest` adds the manifest number rules (no -0, integers within ±(2^53 − 1))
 * on top of plain RFC 8785, which only forbids non-finite numbers.
 */
function serialize(value: JsonValue, path: string, manifest: boolean): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (manifest) assertIJsonNumber(value, path);
      return serializeJcsNumber(value);
    case "string":
      return serializeString(value, path);
    case "object":
      if (Array.isArray(value)) {
        // Array order is meaningful and is never reordered.
        return `[${value.map((item, index) => serialize(item, `${path}[${index}]`, manifest)).join(",")}]`;
      }
      return serializeObject(value, path, manifest);
    default:
      throw new ManifestError("UNSUPPORTED_VALUE", `${typeof value} at ${path} is not JSON`);
  }
}

function serializeObject(value: JsonObject, path: string, manifest: boolean): string {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== null && prototype !== Object.prototype) {
    throw new ManifestError("UNSUPPORTED_VALUE", `non-plain object at ${path}`);
  }
  const keys = Object.keys(value).sort(compareUtf16);
  const members = keys.map((key) => {
    const keyPath = `${path}.${JSON.stringify(key)}`;
    const member = value[key];
    if (member === undefined) {
      throw new ManifestError("UNSUPPORTED_VALUE", `undefined at ${keyPath}`);
    }
    return `${serializeString(key, `key ${keyPath}`)}:${serialize(member, keyPath, manifest)}`;
  });
  return `{${members.join(",")}}`;
}

/** RFC 8785 canonical form of a JSON value, with the manifest's I-JSON rules enforced. */
export function canonicalize(value: JsonValue): string {
  return serialize(value, "$", true);
}

/**
 * Plain RFC 8785 canonical form, without the manifest number rules: -0 becomes
 * 0 and large integers are allowed. Used to check conformance against the RFC's
 * own examples; manifests and terms_hash always use canonicalize().
 */
export function canonicalizeRfc8785(value: JsonValue): string {
  return serialize(value, "$", false);
}

export function canonicalBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

/**
 * terms_hash = SHA-256(JCS(manifest)), per docs/AGREEMENT_MANIFEST_V1.md §2.
 * The input is the manifest's UTF-8 bytes (or decoded text). It must be a JSON
 * object; this function checks canonical form only, not the v1 manifest shape.
 */
export function termsHash(manifest: Uint8Array | string): Uint8Array {
  const value = parseManifestJson(manifest);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestError("NOT_AN_OBJECT", "an Agreement Manifest must be a JSON object");
  }
  return new Uint8Array(createHash("sha256").update(canonicalBytes(value)).digest());
}

export function termsHashHex(manifest: Uint8Array | string): string {
  return Buffer.from(termsHash(manifest)).toString("hex");
}
