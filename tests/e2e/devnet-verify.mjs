// Phase 3D.4 independent deployment verification (keyless, read-only RPC).
//
// Reads fresh on-chain state at "finalized" commitment and checks it against the
// frozen manifest and the owner's public evidence files. The agreement hash is
// recomputed from on-chain accounts, and every allocation and allocation
// commitment from the transactions' own events, with the TypeScript reference in
// dist/ (run `npm run build` first). Evidence files only say where to look.
//
// Environment:
//   RR_RPC_URL         default https://api.devnet.solana.com
//   RR_MANIFEST        default deployments/devnet/manifest.json
//   RR_IDL_PATH        IDL used to decode accounts (its hash must match the manifest);
//                      default target/devnet/royaltyrail.json
//   RR_EVIDENCE_DIR    default docs/evidence: <cluster>-deployment.json, <cluster>-config.json,
//                      <cluster>-lifecycle-*.json
//   RR_ALLOW_LOCALNET  1 to rehearse against a local validator (no devnet genesis check)
//   RR_REPORT_PATH     default <evidence dir>/<cluster>-verification.json

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import anchor from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";

const { EventParser, Program } = anchor;

const referencePath = new URL("../../dist/packages/royaltyrail-accounting/src/index.js", import.meta.url);
const specPath = new URL("../../dist/packages/royaltyrail-protocol-spec/src/index.js", import.meta.url);
if (!existsSync(referencePath) || !existsSync(specPath)) {
  throw new Error("TypeScript reference build missing: run `npm run build` first");
}
const reference = await import(referencePath.href);
const spec = await import(specPath.href);

const env = process.env;
const RPC_URL = env.RR_RPC_URL ?? "https://api.devnet.solana.com";
const MANIFEST_PATH = env.RR_MANIFEST ?? "deployments/devnet/manifest.json";
const IDL_PATH = env.RR_IDL_PATH ?? "target/devnet/royaltyrail.json";
const EVIDENCE_DIR = env.RR_EVIDENCE_DIR ?? "docs/evidence";
const COMMITMENT = "finalized";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const DEPLOY_WITH_MAX_DATA_LEN = 2;
const TOTAL_SHARE_UNITS = 100_000_000;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bigint = (value) => BigInt(value.toString());
const enumName = (value) => Object.keys(value)[0];
const capitalized = (name) => name[0].toUpperCase() + name.slice(1);
const upperSnake = (name) => name.replace(/([A-Z])/g, "_$1").toUpperCase();
const normalized = (name) => name.replaceAll("_", "").toLowerCase();
const u32Le = (value) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", ...(detail === undefined ? {} : { detail }) });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.log(`FAIL  ${name}: ${error.message}`);
  }
}

async function main() {
  const manifest = json(MANIFEST_PATH);
  assert.equal(manifest.schema, "royaltyrails-devnet-manifest-v1", `${MANIFEST_PATH} is not a devnet manifest`);
  assert.ok(manifest.deployable && manifest.authorities, `${MANIFEST_PATH} has no authorities`);
  const programId = new PublicKey(manifest.programId);
  const authority = Object.fromEntries(Object.entries(manifest.authorities).map(([key, value]) => [key, new PublicKey(value)]));
  const connection = new Connection(RPC_URL, COMMITMENT);

  // ------------------------------------------------------------ cluster and inputs
  const genesis = await connection.getGenesisHash();
  const host = new URL(RPC_URL).hostname;
  const localnet = env.RR_ALLOW_LOCALNET === "1" && (host === "127.0.0.1" || host === "localhost");
  const cluster = localnet ? "localnet" : "devnet";
  await check("cluster is the manifest's devnet (by genesis hash)", () => {
    if (!localnet) assert.equal(genesis, manifest.genesisHash);
    return { genesis, rpc: RPC_URL };
  });

  const idlBytes = readFileSync(IDL_PATH);
  assert.equal(sha256(idlBytes), manifest.artifacts["royaltyrail.json"].sha256, `${IDL_PATH} is not the frozen IDL`);
  const idl = JSON.parse(idlBytes);
  assert.equal(idl.address, manifest.programId, "IDL address differs from the manifest program ID");
  const program = new Program(idl, { connection });
  const eventParser = new EventParser(programId, program.coder);
  const events = (logs, name) => [...eventParser.parseLogs(logs ?? [])].filter((event) => normalized(event.name) === normalized(name));

  const deployment = json(join(EVIDENCE_DIR, `${cluster}-deployment.json`));
  const configEvidence = json(join(EVIDENCE_DIR, `${cluster}-config.json`));
  const lifecycleFiles = readdirSync(EVIDENCE_DIR)
    .filter((name) => name.startsWith(`${cluster}-lifecycle-`) && name.endsWith(".json"))
    .sort();
  const lifecycles = lifecycleFiles.map((name) => ({ name, evidence: json(join(EVIDENCE_DIR, name)) }));

  async function transaction(signature) {
    const tx = await connection.getTransaction(signature, { commitment: COMMITMENT, maxSupportedTransactionVersion: 0 });
    assert.ok(tx?.meta, `transaction ${signature} is not finalized or not found`);
    assert.equal(tx.meta.err, null, `transaction ${signature} failed`);
    const message = tx.transaction.message;
    const keys = message.staticAccountKeys ?? message.accountKeys;
    return { tx, message, keys, signers: keys.slice(0, message.header.numRequiredSignatures) };
  }
  const includesKey = (list, key) => list.some((entry) => entry.equals(key));

  // ------------------------------------------------------------ program and bytes
  const programInfo = await connection.getAccountInfo(programId, COMMITMENT);
  const [expectedProgramData] = PublicKey.findProgramAddressSync([programId.toBuffer()], LOADER);
  await check("program account exists, is executable, and is owned by the upgradeable loader", () => {
    assert.ok(programInfo, "program account not found");
    assert.ok(programInfo.executable, "program account is not executable");
    assert.ok(programInfo.owner.equals(LOADER), `owner is ${programInfo.owner.toBase58()}`);
    assert.equal(programInfo.data.readUInt32LE(0), 2, "not a Program account");
    assert.ok(new PublicKey(programInfo.data.subarray(4, 36)).equals(expectedProgramData), "unexpected ProgramData link");
    assert.equal(deployment.programData, expectedProgramData.toBase58(), "deployment evidence names another ProgramData");
    return { programId: programId.toBase58(), programData: expectedProgramData.toBase58() };
  });

  const programDataInfo = await connection.getAccountInfo(expectedProgramData, COMMITMENT);
  await check("ProgramData upgrade authority is the manifest's upgrade authority", () => {
    const data = programDataInfo.data;
    assert.ok(programDataInfo.owner.equals(LOADER));
    assert.equal(data.readUInt32LE(0), 3, "not a ProgramData account");
    assert.equal(data[12], 1, "program is immutable (no upgrade authority)");
    const onChain = new PublicKey(data.subarray(13, 45));
    assert.ok(onChain.equals(authority.upgradeAuthority), `authority is ${onChain.toBase58()}`);
    assert.equal(data.readBigUInt64LE(4).toString(), String(deployment.deploySlot), "last-deploy slot differs from the evidence");
    return { upgradeAuthority: onChain.toBase58(), lastDeploySlot: data.readBigUInt64LE(4).toString() };
  });

  await check("deployed program bytes are exactly the frozen build", () => {
    const elf = programDataInfo.data.subarray(45);
    const expected = manifest.artifacts["royaltyrail.so"];
    assert.ok(elf.length >= expected.bytes, "ProgramData is shorter than the frozen build");
    assert.equal(sha256(elf.subarray(0, expected.bytes)), expected.sha256);
    assert.ok(elf.subarray(expected.bytes).every((byte) => byte === 0), "ProgramData tail is not zero");
    return { sha256: expected.sha256, bytes: expected.bytes, programDataCapacity: elf.length };
  });

  await check("deployment transaction succeeded, paid by the deployer, signed by the program key and upgrade authority", async () => {
    const { message, keys, signers } = await transaction(deployment.deploySignature);
    assert.ok(keys[0].equals(authority.deployer), "fee payer is not the deployer");
    assert.ok(includesKey(signers, programId), "program keypair did not sign");
    assert.ok(includesKey(signers, authority.upgradeAuthority), "upgrade authority did not sign");
    const deploy = message.compiledInstructions.find(
      (ix) => keys[ix.programIdIndex].equals(LOADER) && Buffer.from(ix.data).readUInt32LE(0) === DEPLOY_WITH_MAX_DATA_LEN,
    );
    assert.ok(deploy, "no DeployWithMaxDataLen instruction");
    assert.ok(deploy.accountKeyIndexes.some((index) => keys[index].equals(programId)), "deploy targets another program");
    return { signature: deployment.deploySignature };
  });

  // ------------------------------------------------------------ ProtocolConfig
  const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  const configInfo = await connection.getAccountInfo(configAddress, COMMITMENT);
  const config = await program.account.protocolConfigState.fetch(configAddress, COMMITMENT);
  const mint = config.settlementMint;
  const deploymentId = createHash("sha256").update(`royaltyrails-deployment-v1|${genesis}|${programId.toBase58()}`).digest();
  await check("ProtocolConfig holds the permanent governance, guardian, token program, and deployment ID", () => {
    assert.ok(configInfo.owner.equals(programId), "config is not owned by the program");
    assert.ok(config.governanceAuthority.equals(authority.governance), `governance is ${config.governanceAuthority.toBase58()}`);
    assert.ok(config.guardianAuthority.equals(authority.guardian), `guardian is ${config.guardianAuthority.toBase58()}`);
    assert.ok(config.tokenProgram.equals(TOKEN_PROGRAM_ID), "token program is not the original SPL Token Program");
    assert.ok(Buffer.from(config.deploymentId).equals(deploymentId), "deployment ID differs from sha256(domain|genesis|program)");
    assert.ok(!config.agreementsPaused && !config.allocationsPaused && !config.claimsPaused, "ProtocolConfig is paused");
    assert.equal(configEvidence.config.address, configAddress.toBase58());
    assert.equal(configEvidence.config.settlementMint, mint.toBase58());
    return {
      config: configAddress.toBase58(),
      governance: config.governanceAuthority.toBase58(),
      guardian: config.guardianAuthority.toBase58(),
      settlementMint: mint.toBase58(),
      deploymentIdHex: deploymentId.toString("hex"),
    };
  });

  await check("initialize_config was co-signed by governance and the upgrade authority", async () => {
    assert.ok(configEvidence.config.initializedThisRun, "config evidence is not from the initializing run");
    const { tx, message, keys, signers } = await transaction(configEvidence.config.initializationSignature);
    assert.ok(includesKey(signers, authority.governance), "governance did not sign");
    assert.ok(includesKey(signers, authority.upgradeAuthority), "upgrade authority did not sign");
    const init = message.compiledInstructions.find((ix) => keys[ix.programIdIndex].equals(programId));
    assert.ok(init, "no RoyaltyRail instruction");
    assert.equal(normalized(program.coder.instruction.decode(Buffer.from(init.data)).name), "initializeconfig");
    const [event] = events(tx.meta.logMessages, "ProtocolInitialized");
    assert.ok(event, "no ProtocolInitialized event");
    assert.ok(event.data.governanceAuthority.equals(authority.governance));
    assert.ok(event.data.guardianAuthority.equals(authority.guardian));
    assert.ok(event.data.settlementMint.equals(mint));
    return { signature: configEvidence.config.initializationSignature };
  });

  // ------------------------------------------------------------ settlement test mint
  const mintState = unpackMint(mint, await connection.getAccountInfo(mint, COMMITMENT), TOKEN_PROGRAM_ID);
  const mintedByEvidence = lifecycles.reduce((sum, { evidence }) => sum + BigInt(evidence.run.minted), 0n);
  await check("settlement test mint: six decimals, deployer mint authority, no freeze authority, supply fully accounted", () => {
    assert.equal(mintState.decimals, 6);
    assert.ok(mintState.mintAuthority?.equals(authority.deployer), "mint authority is not the deployer");
    assert.equal(mintState.freezeAuthority, null, "mint has a freeze authority");
    assert.equal(mintState.supply, mintedByEvidence, "supply differs from the tokens minted by the recorded runs");
    return { mint: mint.toBase58(), supply: mintState.supply.toString() };
  });

  // ------------------------------------------------------------ lifecycle runs
  await check("the 16-participant lifecycle ran at least twice", () => {
    assert.ok(lifecycles.length >= 2, `${lifecycles.length} lifecycle evidence file(s)`);
    return lifecycleFiles;
  });

  async function tokenBalance(address) {
    const info = await connection.getAccountInfo(address, COMMITMENT);
    return info ? unpackAccount(address, info, TOKEN_PROGRAM_ID).amount : 0n;
  }
  const ata = (owner, offCurve = false) =>
    getAssociatedTokenAddressSync(mint, owner, offCurve, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  for (const { name, evidence } of lifecycles) {
    const run = evidence.run;
    const label = name.replace(/\.json$/, "");
    assert.equal(evidence.status, "PASS", `${name} did not pass`);
    const agreement = new PublicKey(run.agreement);
    const state = await program.account.agreementVersionState.fetch(agreement, COMMITMENT);
    const pool = await program.account.revenuePoolState.fetch(new PublicKey(run.revenuePool), COMMITMENT);
    const work = await program.account.workState.fetch(new PublicKey(run.work), COMMITMENT);
    const participants = state.participants;

    await check(`${label}: Work, pool, agreement, vault, and Royalty Inbox addresses are canonical`, () => {
      const [workPda] = PublicKey.findProgramAddressSync([Buffer.from("work"), work.originAuthority.toBuffer(), Buffer.from(work.workId)], programId);
      const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), workPda.toBuffer(), Buffer.from(pool.poolId)], programId);
      const [agreementPda] = PublicKey.findProgramAddressSync([Buffer.from("agreement"), poolPda.toBuffer(), u32Le(state.version)], programId);
      const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), agreementPda.toBuffer()], programId);
      assert.equal(workPda.toBase58(), run.work);
      assert.equal(poolPda.toBase58(), run.revenuePool);
      assert.equal(agreementPda.toBase58(), run.agreement);
      assert.equal(vault.toBase58(), run.vaultAuthority);
      assert.equal(ata(vault, true).toBase58(), run.royaltyInbox);
      assert.ok(pool.work.equals(workPda) && state.revenuePool.equals(poolPda));
    });

    await check(`${label}: agreement hash recomputed from on-chain accounts matches, and all 16 participants approved`, () => {
      assert.equal(participants.length, 16);
      assert.equal(enumName(state.status), "active");
      assert.ok(state.settlementMint.equals(mint) && state.tokenProgram.equals(TOKEN_PROGRAM_ID));
      const sorted = participants.every(
        (participant, index) => index === 0 || Buffer.compare(participants[index - 1].participantAuthority.toBuffer(), participant.participantAuthority.toBuffer()) < 0,
      );
      assert.ok(sorted, "participants are not in canonical order");
      assert.equal(participants.reduce((sum, participant) => sum + participant.shareUnits, 0), TOTAL_SHARE_UNITS);
      assert.equal(state.approvalBitmap, 0xffff, "not every participant approved");
      const hash = spec.agreementHashV1({
        deploymentId: Uint8Array.from(config.deploymentId),
        programId: programId.toBytes(),
        revenuePool: state.revenuePool.toBytes(),
        version: state.version,
        predecessorVersion: state.predecessorVersion,
        settlementMint: state.settlementMint.toBytes(),
        tokenProgram: state.tokenProgram.toBytes(),
        poolKind: spec.RevenuePoolKind[capitalized(enumName(pool.poolKind))],
        settlementBasis: spec.SettlementBasis[capitalized(enumName(pool.settlementBasis))],
        poolMetadataHash: Uint8Array.from(pool.metadataHash),
        termsHash: Uint8Array.from(state.termsHash),
        participants: participants.map((participant) => ({
          participantAuthority: participant.participantAuthority.toBytes(),
          shareUnits: participant.shareUnits,
        })),
      });
      assert.equal(spec.bytesToHex(hash), Buffer.from(state.agreementHash).toString("hex"));
      assert.equal(spec.bytesToHex(hash), run.agreementHashHex);
      return { agreementHashHex: spec.bytesToHex(hash) };
    });

    const referenceAgreement = {
      id: agreement.toBase58(),
      version: state.version,
      settlementBasis: upperSnake(enumName(pool.settlementBasis)),
      participants: participants.map((participant) => ({
        authority: participant.participantAuthority.toBytes(),
        shareUnits: participant.shareUnits,
      })),
    };
    let referenceState = reference.initialState(referenceAgreement);

    await check(`${label}: every allocation and commitment recomputed from its transaction's event matches`, async () => {
      const allocationTxs = run.allocations.map((allocation) => {
        const prefix = allocation.step === "allocate_inbox" ? "allocate_inbox" : allocation.step;
        const record = evidence.transactions.find((entry) => entry.label.startsWith(prefix));
        assert.ok(record, `no transaction recorded for ${allocation.step}`);
        return { allocation, record };
      });
      const recomputed = [];
      for (const [index, { allocation, record }] of allocationTxs.entries()) {
        const { tx } = await transaction(record.signature);
        const [event] = events(tx.meta.logMessages, "RevenueAllocated");
        assert.ok(event, `${allocation.step}: no RevenueAllocated event`);
        assert.ok(event.data.agreement.equals(agreement));
        assert.equal(bigint(event.data.allocationSequence), BigInt(index + 1), `${allocation.step}: sequence`);
        assert.equal(bigint(event.data.grossAmount).toString(), allocation.amount, `${allocation.step}: gross amount`);
        assert.equal(Buffer.from(event.data.paymentReference).toString("hex"), allocation.paymentReferenceHex);
        const result = reference.allocate(referenceAgreement, referenceState, { amount: bigint(event.data.grossAmount) });
        const commitment = spec.allocationCommitmentV1({
          deploymentId: Uint8Array.from(config.deploymentId),
          agreement: agreement.toBytes(),
          allocationSequence: bigint(event.data.allocationSequence),
          mode: event.data.mode,
          grossAmount: bigint(event.data.grossAmount),
          paymentReference: Uint8Array.from(event.data.paymentReference),
          allocations: participants.map((participant, slot) => ({
            participantAuthority: participant.participantAuthority.toBytes(),
            allocationAmount: result.allocations[slot],
          })),
        });
        assert.equal(Buffer.from(event.data.allocationCommitment).toString("hex"), spec.bytesToHex(commitment), `${allocation.step}: commitment`);
        assert.equal(allocation.commitment, spec.bytesToHex(commitment), `${allocation.step}: evidence commitment`);
        assert.deepEqual(allocation.allocations, result.allocations.map(String), `${allocation.step}: evidence allocations`);
        referenceState = result.nextState;
        recomputed.push({ step: allocation.step, mode: event.data.mode, commitment: spec.bytesToHex(commitment) });
      }
      return recomputed;
    });

    await check(`${label}: final agreement state equals the reference engine; every participant fully claimed`, () => {
      assert.equal(bigint(state.cumulativeGross), referenceState.gross);
      assert.equal(bigint(state.cumulativeGross).toString(), run.final.cumulativeGross);
      assert.equal(bigint(state.directFundingNonce), 2n, "direct-funding nonce");
      assert.equal(bigint(state.allocationSequence), 3n, "allocation sequence");
      participants.forEach((participant, index) => {
        assert.equal(bigint(participant.cumulativeAllocated), referenceState.allocated[index], `participant ${index} allocation`);
        assert.equal(bigint(participant.cumulativeClaimed), bigint(participant.cumulativeAllocated), `participant ${index} not fully claimed`);
        assert.equal(participant.participantAuthority.toBase58(), run.participants[index].authority);
        assert.equal(bigint(participant.cumulativeClaimed).toString(), run.participants[index].claimed);
      });
      return { cumulativeGross: bigint(state.cumulativeGross).toString() };
    });

    await check(`${label}: payout rotation, token conservation, and inbox solvency hold on-chain`, async () => {
      const rotated = new PublicKey(run.rotatedPayoutWallet);
      assert.ok(participants[0].payoutWallet.equals(rotated), "participant 0 payout wallet is not the rotated wallet");
      assert.equal(participants[0].payoutRevision, 2);
      const [originalAta, rotatedAta] = run.participants[0].payoutDestination;
      assert.equal(originalAta, ata(participants[0].participantAuthority).toBase58());
      assert.equal(rotatedAta, ata(rotated).toBase58());
      const inbox = await tokenBalance(new PublicKey(run.royaltyInbox));
      const outstanding = participants.reduce((sum, p) => sum + bigint(p.cumulativeAllocated) - bigint(p.cumulativeClaimed), 0n);
      assert.ok(inbox >= outstanding, "Royalty Inbox is insolvent");
      assert.equal(inbox, 0n, "Royalty Inbox should be empty after full claims");
      assert.equal(run.funderTokenAccount, ata(new PublicKey(run.funder)).toBase58());
      const funder = await tokenBalance(new PublicKey(run.funderTokenAccount));
      let held = inbox + funder;
      for (const [index, participant] of participants.entries()) {
        const balance = await tokenBalance(ata(participant.participantAuthority));
        const extra = index === 0 ? await tokenBalance(new PublicKey(rotatedAta)) : 0n;
        assert.equal(balance + extra, bigint(participant.cumulativeClaimed), `participant ${index} payout balance`);
        held += balance + extra;
      }
      assert.equal(held, BigInt(run.minted), "tokens minted for this run are not conserved");
      return { minted: run.minted, held: held.toString(), royaltyInbox: inbox.toString() };
    });

    await check(`${label}: all ${evidence.transactions.length} recorded transactions are finalized, succeeded, and were paid by the deployer`, async () => {
      assert.equal(new Set(evidence.transactions.map((record) => record.signature)).size, evidence.transactions.length);
      for (const record of evidence.transactions) {
        const { keys } = await transaction(record.signature);
        assert.ok(keys[0].equals(authority.deployer), `${record.label}: fee payer is not the deployer`);
      }
    });
  }

  // ------------------------------------------------------------ report
  const failed = results.filter((result) => result.status !== "PASS");
  const report = {
    suite: "phase-3d.4-independent-verification",
    cluster,
    genesis,
    rpcUrl: RPC_URL,
    commitment: COMMITMENT,
    verifiedAt: new Date().toISOString(),
    manifestSha256: sha256(readFileSync(MANIFEST_PATH)),
    programId: programId.toBase58(),
    evidence: [`${cluster}-deployment.json`, `${cluster}-config.json`, ...lifecycleFiles],
    checks: results,
    status: failed.length === 0 ? "PASS" : "FAIL",
  };
  const reportPath = env.RR_REPORT_PATH ?? join(EVIDENCE_DIR, `${cluster}-verification.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${results.length - failed.length}/${results.length} checks passed; report ${reportPath}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
