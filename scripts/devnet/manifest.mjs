// Devnet deployment manifest (Node built-ins only, no keys).
//
//   create        --artifact-dir <dir> --out <file> [--authorities <authorities.json>]
//                 CI: describe a build (commit, program ID, hashes, toolchain, CI run, expected authorities).
//   verify-frozen --frozen <manifest.json> --artifact-dir <dir>
//                 CI: if the program build inputs are unchanged since the frozen manifest's commit,
//                 this build must reproduce its hashes exactly; otherwise the manifest is stale.
//   check-artifact --manifest <manifest.json> --artifact-dir <dir>
//                 Deploy: the downloaded artifact must be exactly the frozen build, built from
//                 program sources identical to this checkout's.
//   get <manifest.json> <field/path>
//                 Print one manifest field, e.g. authorities/governance or artifacts/royaltyrail.so/sha256.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEVNET_GENESIS, assertPubkey, base58Decode, readAuthorities } from "./program-id.mjs";

const SCHEMA = "royaltyrails-devnet-manifest-v1";
// Everything that determines royaltyrail.so and royaltyrail.json.
export const BUILD_INPUTS = ["programs", "crates", "Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "Anchor.toml"];
const FILES = ["royaltyrail.so", "royaltyrail.json"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", ["-c", "safe.directory=*", ...args], { encoding: "utf8" }).trim();

function buildInputsUnchanged(commit) {
  try {
    git("cat-file", "-e", `${commit}^{commit}`);
  } catch {
    throw new Error(`commit ${commit} is not in this checkout (fetch the full history)`);
  }
  try {
    git("diff", "--quiet", commit, "HEAD", "--", ...BUILD_INPUTS);
    return true;
  } catch {
    return false;
  }
}

function describeArtifact(dir) {
  const files = {};
  for (const name of FILES) {
    const bytes = readFileSync(join(dir, name));
    files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  const idl = JSON.parse(readFileSync(join(dir, "royaltyrail.json"), "utf8"));
  const programId = assertPubkey("IDL address", idl.address);
  const so = readFileSync(join(dir, "royaltyrail.so"));
  if (so.indexOf(base58Decode(programId)) < 0) throw new Error(`royaltyrail.so does not embed ${programId}`);
  return { programId, files };
}

function create({ "artifact-dir": dir, out, authorities: authoritiesPath }) {
  const { programId, files } = describeArtifact(dir);
  const sourceCommit = readFileSync(join(dir, "SOURCE_COMMIT"), "utf8").trim();
  const buildInfo = readFileSync(join(dir, "BUILD_INFO"), "utf8").split("\n");
  const line = (prefix) => buildInfo.find((text) => text.startsWith(prefix))?.trim() ?? null;
  let authorities = null;
  if (authoritiesPath && existsSync(authoritiesPath)) {
    const recorded = readAuthorities(authoritiesPath);
    if (recorded.programId !== programId) {
      throw new Error(`authorities programId ${recorded.programId} != built program ID ${programId}`);
    }
    authorities = {
      deployer: recorded.deployer,
      upgradeAuthority: recorded.upgradeAuthority,
      governance: recorded.governance,
      guardian: recorded.guardian,
    };
  }
  const env = process.env;
  const manifest = {
    schema: SCHEMA,
    cluster: "devnet",
    genesisHash: DEVNET_GENESIS,
    programId,
    sourceCommit,
    buildInputs: BUILD_INPUTS,
    toolchain: {
      container: env.RR_BUILD_CONTAINER ?? null,
      anchor: line("anchor-cli"),
      solana: line("solana-cli"),
      rustc: line("rustc"),
    },
    ci: env.GITHUB_RUN_ID
      ? {
          repository: env.GITHUB_REPOSITORY,
          runId: env.GITHUB_RUN_ID,
          runAttempt: env.GITHUB_RUN_ATTEMPT,
          runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
          artifactName: `royaltyrail-sbf-${sourceCommit}`,
        }
      : null,
    artifacts: files,
    authorities,
    deployable: authorities !== null,
  };
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

function readManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.schema !== SCHEMA) throw new Error(`${path} is not a ${SCHEMA} manifest`);
  if (manifest.cluster !== "devnet" || manifest.genesisHash !== DEVNET_GENESIS) {
    throw new Error(`${path} is not a devnet manifest`);
  }
  if (JSON.stringify(manifest.buildInputs) !== JSON.stringify(BUILD_INPUTS)) {
    throw new Error(`${path} lists different build inputs than this checkout`);
  }
  return manifest;
}

function compareBuild(manifest, dir) {
  const { programId, files } = describeArtifact(dir);
  const problems = [];
  if (programId !== manifest.programId) problems.push(`program ID ${programId} != ${manifest.programId}`);
  for (const name of FILES) {
    if (files[name].sha256 !== manifest.artifacts[name].sha256) {
      problems.push(`${name} sha256 ${files[name].sha256} != ${manifest.artifacts[name].sha256}`);
    }
  }
  return { programId, files, problems };
}

function verifyFrozen({ frozen, "artifact-dir": dir }) {
  const manifest = readManifest(frozen);
  if (!buildInputsUnchanged(manifest.sourceCommit)) {
    throw new Error(
      `program build inputs changed since the frozen manifest's commit ${manifest.sourceCommit}: ` +
        "the frozen devnet manifest is stale and must be regenerated before any deployment",
    );
  }
  const { problems, files } = compareBuild(manifest, dir);
  if (problems.length > 0) throw new Error(`build is not reproducible against the frozen manifest: ${problems.join("; ")}`);
  console.log(`reproducible: ${FILES.map((name) => `${name} ${files[name].sha256}`).join(", ")} match ${frozen}`);
}

function checkArtifact({ manifest: path, "artifact-dir": dir }) {
  const manifest = readManifest(path);
  if (!manifest.deployable || !manifest.authorities) throw new Error(`${path} is not deployable (no authorities)`);
  const { problems } = compareBuild(manifest, dir);
  const sourceCommit = readFileSync(join(dir, "SOURCE_COMMIT"), "utf8").trim();
  if (sourceCommit !== manifest.sourceCommit) problems.push(`artifact commit ${sourceCommit} != ${manifest.sourceCommit}`);
  if (existsSync(join(dir, "MANIFEST.json"))) {
    const built = JSON.parse(readFileSync(join(dir, "MANIFEST.json"), "utf8"));
    for (const field of ["programId", "sourceCommit", "artifacts", "authorities", "toolchain"]) {
      if (JSON.stringify(built[field]) !== JSON.stringify(manifest[field])) problems.push(`artifact MANIFEST.json ${field} differs`);
    }
  }
  if (problems.length > 0) throw new Error(`artifact does not match the frozen manifest: ${problems.join("; ")}`);
  if (!buildInputsUnchanged(manifest.sourceCommit)) {
    throw new Error(`this checkout's program sources differ from the manifest's commit ${manifest.sourceCommit}`);
  }
  console.log(`artifact matches ${path}: program ${manifest.programId}, commit ${manifest.sourceCommit}`);
}

function get(path, field) {
  let value = readManifest(path);
  for (const key of field.split("/")) value = value?.[key];
  if (value === undefined || value === null) throw new Error(`${path} has no ${field}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith("--")) throw new Error(`unexpected argument ${argv[index]}`);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "create") create(parseArgs(rest));
    else if (command === "verify-frozen") verifyFrozen(parseArgs(rest));
    else if (command === "check-artifact") checkArtifact(parseArgs(rest));
    else if (command === "get" && rest.length === 2) get(...rest);
    else throw new Error("usage: manifest.mjs create|verify-frozen|check-artifact [--options] | get <manifest> <field>");
  } catch (error) {
    console.error(`manifest: ${error.message}`);
    process.exit(1);
  }
}
