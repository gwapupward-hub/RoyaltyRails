/** A JSON value as produced by the strict parser. Objects have a null prototype. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Stable rejection codes. Each maps to one rule in docs/AGREEMENT_MANIFEST_V1.md §2,
 * RFC 8785 (JCS), or RFC 7493 (I-JSON).
 */
export type ManifestErrorCode =
  | "INVALID_UTF8"
  | "BYTE_ORDER_MARK"
  | "SYNTAX"
  | "DUPLICATE_KEY"
  | "LONE_SURROGATE"
  | "NONCHARACTER"
  | "NEGATIVE_ZERO"
  | "NON_FINITE_NUMBER"
  | "UNSAFE_INTEGER"
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_VALUE";

export class ManifestError extends Error {
  readonly code: ManifestErrorCode;

  constructor(code: ManifestErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ManifestError";
    this.code = code;
  }
}
