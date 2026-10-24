import { ManifestError } from "./types.js";

/**
 * RFC 7493 §2.1: I-JSON text MUST NOT contain code points that identify
 * surrogates (unpaired here, since paired escapes denote one code point) or
 * noncharacters (U+FDD0..U+FDEF and U+xxFFFE / U+xxFFFF in every plane).
 */
export function assertIJsonString(value: string, where: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    let codePoint = unit;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new ManifestError("LONE_SURROGATE", `unpaired high surrogate in ${where}`);
      }
      codePoint = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ManifestError("LONE_SURROGATE", `unpaired low surrogate in ${where}`);
    }
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe) {
      throw new ManifestError(
        "NONCHARACTER",
        `noncharacter U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} in ${where}`,
      );
    }
  }
}

/**
 * Number rules: RFC 8785 §3.2.2.3 forbids NaN and Infinity; the manifest spec
 * forbids -0; I-JSON (RFC 7493 §2.2) plus the manifest's "safe JSON-number
 * precision" rule require integers to lie within ±(2^53 − 1). Larger values,
 * such as base-unit money amounts, must be decimal strings.
 */
export function assertIJsonNumber(value: number, where: string): void {
  if (!Number.isFinite(value)) {
    throw new ManifestError("NON_FINITE_NUMBER", `non-finite number in ${where}`);
  }
  if (Object.is(value, -0)) {
    throw new ManifestError("NEGATIVE_ZERO", `negative zero in ${where}`);
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new ManifestError(
      "UNSAFE_INTEGER",
      `integer ${value} in ${where} exceeds ±(2^53 − 1); use a decimal string`,
    );
  }
}
