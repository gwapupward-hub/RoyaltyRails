import { assertIJsonNumber, assertIJsonString } from "./ijson.js";
import { ManifestError, type JsonObject, type JsonValue } from "./types.js";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Decodes UTF-8 bytes strictly. Malformed sequences, overlongs, and encoded
 * surrogates are rejected rather than replaced with U+FFFD. A leading byte
 * order mark is rejected: RFC 8259 §8.1 forbids emitting one, and accepting it
 * would give one manifest two byte-level encodings.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new ManifestError("INVALID_UTF8", "input is not well-formed UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new ManifestError("BYTE_ORDER_MARK", "input starts with a byte order mark");
  }
  return text;
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/**
 * Strict RFC 8259 parser with the manifest's I-JSON rules applied while parsing.
 * JSON.parse is not used because it silently keeps the last of duplicate keys.
 * Duplicate detection compares keys after unescaping, so "a" and "a" collide.
 */
class Parser {
  private index = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue("$");
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("unexpected trailing content");
    return value;
  }

  private fail(message: string): never {
    throw new ManifestError("SYNTAX", `${message} at offset ${this.index}`);
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length) {
      const c = this.text.charCodeAt(this.index);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
      this.index += 1;
    }
  }

  private expectLiteral(literal: string): void {
    if (this.text.startsWith(literal, this.index)) {
      this.index += literal.length;
    } else {
      this.fail("invalid literal");
    }
  }

  private parseValue(path: string): JsonValue {
    const c = this.text[this.index];
    switch (c) {
      case "{":
        return this.parseObject(path);
      case "[":
        return this.parseArray(path);
      case '"': {
        const value = this.parseString();
        assertIJsonString(value, path);
        return value;
      }
      case "t":
        this.expectLiteral("true");
        return true;
      case "f":
        this.expectLiteral("false");
        return false;
      case "n":
        this.expectLiteral("null");
        return null;
      default:
        return this.parseNumber(path);
    }
  }

  private parseObject(path: string): JsonObject {
    this.index += 1;
    const out: JsonObject = Object.create(null) as JsonObject;
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("expected object key");
      const key = this.parseString();
      const keyPath = `${path}.${JSON.stringify(key)}`;
      assertIJsonString(key, `key ${keyPath}`);
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new ManifestError("DUPLICATE_KEY", `duplicate key ${keyPath}`);
      }
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("expected ':'");
      this.index += 1;
      this.skipWhitespace();
      out[key] = this.parseValue(keyPath);
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "}") return out;
      if (next !== ",") {
        this.index -= 1;
        this.fail("expected ',' or '}'");
      }
    }
  }

  private parseArray(path: string): JsonValue[] {
    this.index += 1;
    const out: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return out;
    }
    for (;;) {
      this.skipWhitespace();
      out.push(this.parseValue(`${path}[${out.length}]`));
      this.skipWhitespace();
      const next = this.text[this.index];
      this.index += 1;
      if (next === "]") return out;
      if (next !== ",") {
        this.index -= 1;
        this.fail("expected ',' or ']'");
      }
    }
  }

  private parseString(): string {
    this.index += 1;
    let out = "";
    for (;;) {
      if (this.index >= this.text.length) this.fail("unterminated string");
      const c = this.text.charCodeAt(this.index);
      if (c === 0x22) {
        this.index += 1;
        return out;
      }
      if (c < 0x20) this.fail("unescaped control character in string");
      if (c !== 0x5c) {
        out += this.text[this.index];
        this.index += 1;
        continue;
      }
      const escape = this.text[this.index + 1];
      this.index += 2;
      switch (escape) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = this.text.slice(this.index, this.index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid \\u escape");
          out += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 4;
          break;
        }
        default:
          this.index -= 2;
          this.fail("invalid escape");
      }
    }
  }

  private parseNumber(path: string): number {
    NUMBER.lastIndex = this.index;
    const match = NUMBER.exec(this.text);
    if (match === null || match[0].length === 0) this.fail("unexpected character");
    this.index += match[0].length;
    const value = Number(match[0]);
    assertIJsonNumber(value, path);
    return value;
  }
}

/** Parses a manifest from UTF-8 bytes, or from an already-decoded string. */
export function parseManifestJson(input: Uint8Array | string): JsonValue {
  let text: string;
  if (typeof input === "string") {
    if (input.charCodeAt(0) === 0xfeff) {
      throw new ManifestError("BYTE_ORDER_MARK", "input starts with a byte order mark");
    }
    text = input;
  } else {
    text = decodeUtf8(input);
  }
  return new Parser(text).parseDocument();
}
