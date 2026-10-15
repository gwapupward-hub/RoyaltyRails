import { readFileSync } from "node:fs";

const constants = JSON.parse(
  readFileSync(new URL("../spec/royaltyrail-v1.constants.json", import.meta.url), "utf8"),
);

const authoritativeFiles = [
  "README.md",
  "docs/ACCOUNTING_V1.md",
  "docs/ACCOUNT_LAYOUT_V1.md",
  "docs/AGREEMENT_MANIFEST_V1.md",
  "docs/INTEGRATION_UX_V1.md",
  "docs/PROTOCOL_V1.md",
  "docs/SECURITY_V1.md",
  "docs/STATE_MACHINE_V1.md",
  "packages/royaltyrail-accounting/src/types.ts",
  "packages/royaltyrail-accounting/src/settlement.ts",
  "packages/royaltyrail-protocol-spec/src/encoding.ts",
];

const forbidden = [
  { pattern: /10[_ ,]?000\s+(?:BPS|share units)/gi, reason: "legacy 10,000-share denominator" },
  { pattern: /\b2\s*[–-]\s*16\s+(?:participants|recipients)/gi, reason: "legacy 2–16 participant range" },
  { pattern: /\bshare_bps\b|\bshareBps\b/g, reason: "legacy BPS field name" },
  { pattern: /direct atomic settlement/gi, reason: "obsolete push-settlement terminology" },
  { pattern: /payout commitment/gi, reason: "obsolete payout-commitment terminology" },
  { pattern: /permissionless full-inbox settlement/gi, reason: "obsolete inbox-settlement terminology" },
];

const errors = [];

for (const path of authoritativeFiles) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      errors.push(`${path}: ${rule.reason}: ${JSON.stringify(match[0])}`);
    }
  }
}

const accountingTypes = readFileSync(
  new URL("../packages/royaltyrail-accounting/src/types.ts", import.meta.url),
  "utf8",
);
const protocolEncoding = readFileSync(
  new URL("../packages/royaltyrail-protocol-spec/src/encoding.ts", import.meta.url),
  "utf8",
);

const expectedShareLiteral = "TOTAL_SHARE_UNITS = 100_000_000";
for (const [path, text] of [
  ["packages/royaltyrail-accounting/src/types.ts", accountingTypes],
  ["packages/royaltyrail-protocol-spec/src/encoding.ts", protocolEncoding],
]) {
  if (!text.includes(expectedShareLiteral)) {
    errors.push(`${path}: missing canonical ${expectedShareLiteral}`);
  }
}

if (!accountingTypes.includes(`MIN_RECIPIENTS = ${constants.minParticipants}`)) {
  errors.push("accounting types min participant constant does not match machine-readable spec");
}
if (!accountingTypes.includes(`MAX_RECIPIENTS = ${constants.maxParticipants}`)) {
  errors.push("accounting types max participant constant does not match machine-readable spec");
}
if (!protocolEncoding.includes(`MIN_PARTICIPANTS = ${constants.minParticipants}`)) {
  errors.push("protocol encoder min participant constant does not match machine-readable spec");
}
if (!protocolEncoding.includes(`MAX_PARTICIPANTS = ${constants.maxParticipants}`)) {
  errors.push("protocol encoder max participant constant does not match machine-readable spec");
}
if (constants.totalShareUnits !== 100_000_000) {
  errors.push("machine-readable totalShareUnits must be 100,000,000 for v1");
}
if (constants.percentageDecimalPlaces !== 6) {
  errors.push("machine-readable percentageDecimalPlaces must be 6 for v1");
}

if (errors.length > 0) {
  console.error("RoyaltyRail v1 specification consistency check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `RoyaltyRail v1 specification consistency OK: ${constants.totalShareUnits.toLocaleString()} share units, ${constants.minParticipants}–${constants.maxParticipants} participants.`,
);
