// Program-identity helpers for the devnet scripts (Node built-ins only, no keys).
//
//   node scripts/devnet/program-id.mjs check --so <royaltyrail.so> --idl <royaltyrail.json>
//        [--source <lib.rs>] [--anchor-toml <Anchor.toml>] [--authorities <authorities.json>] [--expect <pubkey>]
//     Verifies that every given source names one program ID: declare_id!, the IDL address,
//     the raw 32-byte ID embedded in the binary, Anchor.toml program entries, and the
//     recorded devnet authorities. Exits non-zero on any mismatch.
//
//   node scripts/devnet/program-id.mjs sync <authorities.json>
//     Validates the five public keys and writes the program ID to declare_id! and
//     Anchor.toml ([programs.localnet] and [programs.devnet]).

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const AUTHORITY_FIELDS = ["programId", "deployer", "upgradeAuthority", "governance", "guardian"];
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SOURCE_PATH = "programs/royaltyrail/src/lib.rs";
const DECLARE_ID = /declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/;

export function base58Decode(text) {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`invalid base58 character in ${text}`);
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

export function assertPubkey(label, text) {
  if (typeof text !== "string" || base58Decode(text).length !== 32) {
    throw new Error(`${label} is not a 32-byte base58 public key: ${text}`);
  }
  return text;
}

export function readAuthorities(path) {
  const authorities = JSON.parse(readFileSync(path, "utf8"));
  if (authorities.cluster !== "devnet" || authorities.genesisHash !== DEVNET_GENESIS) {
    throw new Error(`${path} must name the devnet cluster and genesis hash ${DEVNET_GENESIS}`);
  }
  for (const field of AUTHORITY_FIELDS) assertPubkey(`${path} ${field}`, authorities[field]);
  if (new Set(AUTHORITY_FIELDS.map((field) => authorities[field])).size !== AUTHORITY_FIELDS.length) {
    throw new Error(`${path}: the five public keys must be distinct`);
  }
  return authorities;
}

function anchorTomlIds(text) {
  const ids = {};
  let section = null;
  for (const line of text.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1].trim();
    const entry = line.match(/^\s*royaltyrail\s*=\s*"([^"]+)"/);
    if (entry && section?.startsWith("programs.")) ids[section] = entry[1];
  }
  return ids;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith("--")) throw new Error(`unexpected argument ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  return options;
}

function check(options) {
  if (!options.so || !options.idl) throw new Error("check requires --so and --idl");
  const sources = {};
  const idl = JSON.parse(readFileSync(options.idl, "utf8"));
  sources.idlAddress = idl.address;
  if (options.source) sources.declareId = readFileSync(options.source, "utf8").match(DECLARE_ID)?.[1];
  if (options["anchor-toml"]) {
    for (const [section, id] of Object.entries(anchorTomlIds(readFileSync(options["anchor-toml"], "utf8")))) {
      sources[`Anchor.toml [${section}]`] = id;
    }
  }
  if (options.authorities) sources.authoritiesProgramId = readAuthorities(options.authorities).programId;
  if (options.expect) sources.expected = options.expect;

  const programId = assertPubkey("IDL address", sources.idlAddress);
  const mismatches = Object.entries(sources).filter(([, id]) => id !== programId);
  const binary = readFileSync(options.so);
  const raw = base58Decode(programId);
  let embedded = 0;
  for (let at = binary.indexOf(raw); at >= 0; at = binary.indexOf(raw, at + 1)) embedded += 1;
  const report = { programId, sources, binaryEmbeddedCopies: embedded };
  console.log(JSON.stringify(report, null, 2));
  if (mismatches.length > 0) {
    throw new Error(`program ID mismatch: ${mismatches.map(([name, id]) => `${name}=${id}`).join(", ")}`);
  }
  if (embedded === 0) throw new Error(`${options.so} does not embed program ID ${programId}`);
}

function sync(authoritiesPath) {
  const { programId } = readAuthorities(authoritiesPath);
  const source = readFileSync(SOURCE_PATH, "utf8");
  if (!DECLARE_ID.test(source)) throw new Error(`no declare_id! in ${SOURCE_PATH}`);
  writeFileSync(SOURCE_PATH, source.replace(DECLARE_ID, `declare_id!("${programId}")`));

  const lines = readFileSync("Anchor.toml", "utf8").split("\n");
  const hasDevnet = lines.some((line) => /^\s*\[programs\.devnet\]/.test(line));
  const out = [];
  let section = null;
  // [programs.devnet] is inserted directly after [programs.localnet] if it is missing.
  const insertDevnet = () => {
    while (out.at(-1) === "") out.pop();
    out.push("", "[programs.devnet]", `royaltyrail = "${programId}"`, "");
  };
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      if (section === "programs.localnet" && !hasDevnet) insertDevnet();
      section = header[1].trim();
    }
    if (/^\s*royaltyrail\s*=/.test(line) && (section === "programs.localnet" || section === "programs.devnet")) {
      out.push(`royaltyrail = "${programId}"`);
    } else {
      out.push(line);
    }
  }
  if (section === "programs.localnet" && !hasDevnet) insertDevnet();
  writeFileSync("Anchor.toml", out.join("\n"));
  console.log(`program ID ${programId} written to ${SOURCE_PATH} and Anchor.toml`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "check") check(parseArgs(rest));
    else if (command === "sync" && rest.length === 1) sync(rest[0]);
    else throw new Error("usage: program-id.mjs check --so <file> --idl <file> [...] | sync <authorities.json>");
  } catch (error) {
    console.error(`program-id: ${error.message}`);
    process.exit(1);
  }
}
