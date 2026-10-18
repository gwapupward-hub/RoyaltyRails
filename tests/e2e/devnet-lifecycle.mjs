// Phase 3D.4 cluster-agnostic lifecycle (localnet rehearsal and devnet smoke).
//
// Runs the complete v1 settlement lifecycle against an already-deployed
// RoyaltyRail program with the maximum 16 participants, and cross-checks every
// on-chain agreement hash, allocation, and allocation commitment against the
// TypeScript reference implementation in dist/ (run `npm run build` first).
//
// Safety properties:
// - refuses mainnet-beta, testnet, and any non-local cluster other than devnet;
// - the provider wallet pays every fee and all rent and is the test Work origin /
//   RevenuePool manager; test identities (16 participants, funder, rotated
//   payout wallet) are generated in memory, only sign, and are never written;
// - private keys are never printed or written; the evidence file holds only
//   public keys, signatures, hashes, and amounts.
//
// Environment:
//   ANCHOR_PROVIDER_URL, ANCHOR_WALLET   provider RPC and fee-payer/test-mint-authority keypair
//   RR_EXPECTED_PROGRAM_ID               required on devnet; must equal the IDL address
//   RR_EXPECTED_UPGRADE_AUTHORITY        required on devnet; must equal the ProgramData authority
//   RR_EXPECTED_GOVERNANCE               required on devnet; governance pubkey to initialize or verify
//   RR_EXPECTED_GUARDIAN                 required on devnet; guardian pubkey to initialize or verify
//   RR_GOVERNANCE_KEYPAIR                governance keypair path; only read if ProtocolConfig is absent
//   RR_UPGRADE_AUTHORITY_KEYPAIR         upgrade-authority keypair path; only read if ProtocolConfig is
//                                        absent (initialize_config requires its co-signature)
//   RR_INIT_ONLY=1                       initialize (or verify) ProtocolConfig, record it, and stop. On
//                                        devnet this is the only mode that initializes; lifecycle runs
//                                        require an existing config and never read the critical keys.
//   RR_IDL_PATH                          default target/idl/royaltyrail.json
//   RR_PROGRAM_SO                        default target/deploy/royaltyrail.so (deployed bytes are compared)
//   RR_EVIDENCE_PATH                     default target/e2e/<cluster>-lifecycle-<timestamp>.json

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import anchor from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  MINT_SIZE,
} from "@solana/spl-token";

// @anchor-lang/core ships CommonJS to Node; BN is not detectable as a named
// ESM export, so destructure from the default export instead.
const { AnchorProvider, BN, EventParser, Program, setProvider } = anchor;

const referencePath = new URL("../../dist/packages/royaltyrail-accounting/src/index.js", import.meta.url);
const specPath = new URL("../../dist/packages/royaltyrail-protocol-spec/src/index.js", import.meta.url);
if (!existsSync(referencePath) || !existsSync(specPath)) {
  throw new Error("TypeScript reference build missing: run `npm run build` first");
}
const reference = await import(referencePath.href);
const spec = await import(specPath.href);

const GENESIS = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const USDC_DECIMALS = 6;
const PARTICIPANT_COUNT = 16;
const CONFIG_SEED = Buffer.from("config");
const WORK_SEED = Buffer.from("work");
const POOL_SEED = Buffer.from("pool");
const AGREEMENT_SEED = Buffer.from("agreement");
const VAULT_SEED = Buffer.from("vault");
// Uneven shares so every allocation exercises the bounded-error rounding path.
const LEADING_SHARES = [
  12_345_678, 9_876_543, 8_765_432, 7_654_321, 6_543_210, 5_432_109, 4_321_098, 3_210_987,
  2_109_876, 1_098_765, 987_654, 876_543, 765_432, 654_321, 543_210,
];
// Deposit amounts chosen to leave non-zero rounding residuals.
const DIRECT_FUNDING_1 = 1_000_003n;
const RAW_DEPOSIT_1 = 777_777n;
const DIRECT_FUNDING_2 = 333_331n;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function u32Le(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function bigint(value) {
  if (typeof value === "bigint") return value;
  return BigInt(value.toString());
}

function enumName(value) {
  return Object.keys(value)[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadKeypair(path) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function requiredPubkey(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required on this cluster`);
  return new PublicKey(value);
}

function optionalPubkey(name) {
  return process.env[name] ? new PublicKey(process.env[name]) : null;
}

async function detectCluster(connection, rpcUrl) {
  const genesis = await connection.getGenesisHash();
  if (genesis === GENESIS.mainnet || genesis === GENESIS.testnet) {
    throw new Error(`refusing to run against ${genesis === GENESIS.mainnet ? "mainnet-beta" : "testnet"}`);
  }
  if (genesis === GENESIS.devnet) return { cluster: "devnet", genesis };
  const host = new URL(rpcUrl).hostname;
  if (host === "127.0.0.1" || host === "localhost") return { cluster: "localnet", genesis };
  throw new Error(`unrecognized non-local cluster (genesis ${genesis}); only devnet and localnet are allowed`);
}

async function main() {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const connection = provider.connection;
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL;
  const wallet = loadKeypair(process.env.ANCHOR_WALLET);
  assert.ok(provider.publicKey.equals(wallet.publicKey), "Anchor provider wallet must match ANCHOR_WALLET");

  const { cluster, genesis } = await detectCluster(connection, rpcUrl);
  const onDevnet = cluster === "devnet";
  const explorer = (kind, id) =>
    onDevnet ? `https://explorer.solana.com/${kind}/${id}?cluster=devnet` : null;
  console.log(`cluster: ${cluster} (genesis ${genesis})`);

  const idlPath = process.env.RR_IDL_PATH ?? "target/idl/royaltyrail.json";
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));
  const program = new Program(idl, provider);
  const programId = program.programId;
  const methods = program.methods;

  // ------------------------------------------------ deployed program identity
  const expectedProgramId = onDevnet ? requiredPubkey("RR_EXPECTED_PROGRAM_ID") : optionalPubkey("RR_EXPECTED_PROGRAM_ID");
  if (expectedProgramId) {
    assert.ok(programId.equals(expectedProgramId), `IDL address ${programId.toBase58()} != RR_EXPECTED_PROGRAM_ID`);
  }
  const programInfo = await connection.getAccountInfo(programId, "confirmed");
  assert.ok(programInfo?.executable, `program ${programId.toBase58()} is not deployed on ${cluster}`);

  const programSoPath = process.env.RR_PROGRAM_SO ?? "target/deploy/royaltyrail.so";
  const localElf = existsSync(programSoPath) ? readFileSync(programSoPath) : null;
  const programEvidence = {
    programId: programId.toBase58(),
    loader: programInfo.owner.toBase58(),
    idlSha256: sha256Hex(readFileSync(idlPath)),
    localProgramSha256: localElf ? sha256Hex(localElf) : null,
  };
  let deployedElf;
  if (programInfo.owner.equals(BPF_LOADER_UPGRADEABLE)) {
    const programData = new PublicKey(programInfo.data.subarray(4, 36));
    const programDataInfo = await connection.getAccountInfo(programData, "confirmed");
    const data = programDataInfo.data;
    const hasAuthority = data[12] === 1;
    programEvidence.programData = programData.toBase58();
    programEvidence.lastDeploySlot = data.readBigUInt64LE(4).toString();
    programEvidence.upgradeAuthority = hasAuthority ? new PublicKey(data.subarray(13, 45)).toBase58() : null;
    deployedElf = data.subarray(45);
  } else {
    deployedElf = programInfo.data;
  }
  if (onDevnet) {
    assert.ok(programInfo.owner.equals(BPF_LOADER_UPGRADEABLE), "devnet program must use the upgradeable loader");
    const expectedUpgradeAuthority = requiredPubkey("RR_EXPECTED_UPGRADE_AUTHORITY");
    assert.equal(programEvidence.upgradeAuthority, expectedUpgradeAuthority.toBase58(), "unexpected upgrade authority");
  }
  if (localElf) {
    // ProgramData may be longer than the ELF (max-len); the tail must be zero.
    assert.ok(deployedElf.length >= localElf.length, "deployed program is shorter than the local build");
    const deployedPrefix = deployedElf.subarray(0, localElf.length);
    const tail = deployedElf.subarray(localElf.length);
    programEvidence.deployedProgramSha256 = sha256Hex(deployedPrefix);
    programEvidence.deployedMatchesLocalBuild =
      deployedPrefix.equals(localElf) && tail.every((byte) => byte === 0);
    assert.ok(programEvidence.deployedMatchesLocalBuild, "deployed bytes differ from RR_PROGRAM_SO");
  }

  // ------------------------------------------------------- transaction helper
  const transactions = [];
  const eventParser = new EventParser(programId, program.coder);

  async function send(label, transaction, signers = []) {
    const unique = new Map();
    for (const signer of [wallet, ...signers]) unique.set(signer.publicKey.toBase58(), signer);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = wallet.publicKey;
      transaction.recentBlockhash = blockhash;
      transaction.signatures = [];
      transaction.sign(...unique.values());
      const raw = transaction.serialize();
      const signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 10,
      });
      try {
        const confirmation = await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (confirmation.value.err) {
          throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
        }
      } catch (error) {
        // web3.js can reject with the raw TransactionError of a landed failure.
        if (error && typeof error === "object" && "InstructionError" in error) {
          throw new Error(`${label} failed: ${JSON.stringify(error)}`);
        }
        // Only an expired blockhash is retried, and only if the signature never landed.
        if (error?.name !== "TransactionExpiredBlockheightExceededError") throw error;
        const status = (await connection.getSignatureStatus(signature, { searchTransactionHistory: true })).value;
        if (!status) {
          console.log(`  ${label}: blockhash expired before landing; retrying (${attempt}/3)`);
          continue;
        }
        if (status.err) throw new Error(`${label} failed: ${JSON.stringify(status.err)}`);
      }
      let result = null;
      for (let poll = 0; poll < 60 && !result; poll += 1) {
        result = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!result) await sleep(500);
      }
      assert.ok(result?.meta, `${label}: transaction ${signature} not retrievable`);
      assert.equal(result.meta.err, null, `${label}: landed with error`);
      const record = {
        label,
        signature,
        slot: result.slot,
        computeUnits: result.meta.computeUnitsConsumed ?? null,
        feeLamports: result.meta.fee,
        transactionBytes: raw.length,
        explorer: explorer("tx", signature),
      };
      transactions.push(record);
      console.log(`  ok ${label}: ${record.computeUnits} CU, ${record.transactionBytes} bytes`);
      return { record, logs: result.meta.logMessages ?? [] };
    }
    throw new Error(`${label}: could not land after 3 attempts`);
  }

  function events(logs, name) {
    return [...eventParser.parseLogs(logs)].filter(
      (event) => event.name.replaceAll("_", "").toLowerCase() === name.toLowerCase(),
    );
  }

  // --------------------------------------------------------- ProtocolConfig
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const initOnly = process.env.RR_INIT_ONLY === "1";
  // Localnet-only default governance: deterministic and publicly derivable, distinct
  // from the provider wallet (the upgrade authority), and initially unfunded, which
  // mirrors the devnet key separation. Defaults are never used on devnet.
  const localnetGovernance = () =>
    Keypair.fromSeed(createHash("sha256").update("royaltyrails-localnet-governance-v1").digest());
  const expectedGovernance = onDevnet
    ? requiredPubkey("RR_EXPECTED_GOVERNANCE")
    : optionalPubkey("RR_EXPECTED_GOVERNANCE") ??
      (process.env.RR_GOVERNANCE_KEYPAIR ? loadKeypair(process.env.RR_GOVERNANCE_KEYPAIR) : localnetGovernance()).publicKey;
  // Localnet default guardian: a fixed, keyless public key distinct from governance.
  const expectedGuardian = onDevnet
    ? requiredPubkey("RR_EXPECTED_GUARDIAN")
    : optionalPubkey("RR_EXPECTED_GUARDIAN") ??
      new PublicKey(createHash("sha256").update("royaltyrails-localnet-guardian-v1").digest());
  assert.ok(!expectedGovernance.equals(expectedGuardian), "governance and guardian must differ");

  let configState = await program.account.protocolConfigState.fetchNullable(config, "confirmed");
  let configInitialization = null;
  if (!configState) {
    assert.ok(
      !onDevnet || initOnly,
      "ProtocolConfig is not initialized on devnet: run scripts/devnet/init-config.sh first",
    );
    // The critical keys are read only here, when they sign.
    const governance = process.env.RR_GOVERNANCE_KEYPAIR
      ? loadKeypair(process.env.RR_GOVERNANCE_KEYPAIR)
      : onDevnet
        ? null
        : localnetGovernance();
    assert.ok(governance, "ProtocolConfig is absent: RR_GOVERNANCE_KEYPAIR is required to initialize it");
    assert.ok(governance.publicKey.equals(expectedGovernance), "RR_GOVERNANCE_KEYPAIR does not match RR_EXPECTED_GOVERNANCE");
    // initialize_config requires the program's current upgrade authority as co-signer.
    assert.ok(programEvidence.programData, "ProtocolConfig can only be initialized for an upgradeable program");
    const upgradeAuthorityPath =
      process.env.RR_UPGRADE_AUTHORITY_KEYPAIR ?? (onDevnet ? null : process.env.ANCHOR_WALLET);
    assert.ok(upgradeAuthorityPath, "ProtocolConfig is absent: RR_UPGRADE_AUTHORITY_KEYPAIR is required to initialize it");
    const upgradeAuthority = loadKeypair(upgradeAuthorityPath);
    assert.equal(
      upgradeAuthority.publicKey.toBase58(),
      programEvidence.upgradeAuthority,
      "RR_UPGRADE_AUTHORITY_KEYPAIR is not the program's current upgrade authority",
    );

    // initialize_config charges the config rent to governance, normally an
    // unfunded cold key; top up exactly the shortfall from the provider wallet.
    const configRent = await connection.getMinimumBalanceForRentExemption(program.account.protocolConfigState.size);
    const governanceBalance = await connection.getBalance(governance.publicKey, "confirmed");
    if (governanceBalance < configRent) {
      await send(
        "fund governance for ProtocolConfig rent",
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: governance.publicKey,
            lamports: configRent - governanceBalance,
          }),
        ),
      );
    }

    // Fresh six-decimal legacy SPL test mint; the provider wallet is mint authority, no freeze authority.
    const mintKeypair = Keypair.generate();
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const createMint = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        lamports: rent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintKeypair.publicKey, USDC_DECIMALS, wallet.publicKey, null, TOKEN_PROGRAM_ID),
    );
    await send("create settlement test mint", createMint, [mintKeypair]);

    const deploymentId = Array.from(
      createHash("sha256").update(`royaltyrails-deployment-v1|${genesis}|${programId.toBase58()}`).digest(),
    );
    const { record, logs } = await send(
      "initialize ProtocolConfig",
      await methods
        .initializeConfig(deploymentId, expectedGuardian)
        .accountsStrict({
          config,
          governanceAuthority: governance.publicKey,
          upgradeAuthority: upgradeAuthority.publicKey,
          program: programId,
          programData: new PublicKey(programEvidence.programData),
          settlementMint: mintKeypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
      [governance, upgradeAuthority],
    );
    assert.equal(events(logs, "ProtocolInitialized").length, 1, "missing ProtocolInitialized event");
    configInitialization = record.signature;
    configState = await program.account.protocolConfigState.fetch(config, "confirmed");
  }

  // initialize_config requires the upgrade authority, but still verify the stored
  // governance is the expected owner key before using this deployment.
  assert.ok(
    configState.governanceAuthority.equals(expectedGovernance),
    `ProtocolConfig governance is ${configState.governanceAuthority.toBase58()}, not the expected owner key: ` +
      "this deployment was initialized with a different governance key and must not be used",
  );
  assert.ok(configState.guardianAuthority.equals(expectedGuardian), "unexpected guardian authority");
  assert.ok(configState.tokenProgram.equals(TOKEN_PROGRAM_ID), "config must use the original SPL Token Program");
  assert.ok(
    !configState.agreementsPaused && !configState.allocationsPaused && !configState.claimsPaused,
    "ProtocolConfig is paused",
  );
  const mint = configState.settlementMint;
  const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
  assert.equal(mintInfo.decimals, USDC_DECIMALS);
  assert.ok(mintInfo.mintAuthority?.equals(wallet.publicKey), "provider wallet must be the test mint authority");
  const deploymentId = Uint8Array.from(configState.deploymentId);
  const configEvidence = {
    address: config.toBase58(),
    initializedThisRun: configInitialization !== null,
    initializationSignature: configInitialization,
    governance: configState.governanceAuthority.toBase58(),
    guardian: configState.guardianAuthority.toBase58(),
    settlementMint: mint.toBase58(),
    tokenProgram: configState.tokenProgram.toBase58(),
    deploymentIdHex: Buffer.from(deploymentId).toString("hex"),
  };

  if (initOnly) {
    const evidence = {
      suite: "phase-3d.4-config",
      cluster,
      genesis,
      generatedAt: new Date().toISOString(),
      program: programEvidence,
      config: configEvidence,
      transactions,
      checks: [
        "deployed program bytes equal the frozen build",
        "ProgramData upgrade authority is the expected key and co-signed initialize_config",
        "ProtocolConfig governance, guardian, and token program match the expected owner configuration",
        "ProtocolConfig is unpaused; the settlement test mint has six decimals and the deployer as mint authority",
      ],
      status: "PASS",
    };
    const evidencePath =
      process.env.RR_EVIDENCE_PATH ?? `target/e2e/${cluster}-config-${evidence.generatedAt.replaceAll(":", "-")}.json`;
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`evidence written to ${evidencePath}`);
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  // -------------------------------------------------- per-run test identities
  const funder = Keypair.generate();
  const rotatedWallet = Keypair.generate();
  const participants = Array.from({ length: PARTICIPANT_COUNT }, () => Keypair.generate()).sort((a, b) =>
    Buffer.compare(a.publicKey.toBuffer(), b.publicKey.toBuffer()),
  );
  const shares = [...LEADING_SHARES];
  shares.push(100_000_000 - shares.reduce((sum, value) => sum + value, 0));
  assert.equal(shares.length, PARTICIPANT_COUNT);
  assert.ok(shares.every((value) => value > 0));

  const workId = Array.from(randomBytes(32));
  const poolId = Array.from(randomBytes(32));
  const workMetadataHash = Array.from(randomBytes(32));
  const poolMetadataHash = Array.from(randomBytes(32));
  const termsHash = Array.from(randomBytes(32));
  const [work] = PublicKey.findProgramAddressSync([WORK_SEED, wallet.publicKey.toBuffer(), Buffer.from(workId)], programId);
  const [revenuePool] = PublicKey.findProgramAddressSync([POOL_SEED, work.toBuffer(), Buffer.from(poolId)], programId);
  const [agreement] = PublicKey.findProgramAddressSync([AGREEMENT_SEED, revenuePool.toBuffer(), u32Le(1)], programId);
  const [vault] = PublicKey.findProgramAddressSync([VAULT_SEED, agreement.toBuffer()], programId);
  const ata = (owner, offCurve = false) =>
    getAssociatedTokenAddressSync(mint, owner, offCurve, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const inbox = ata(vault, true);
  const funderAta = ata(funder.publicKey);
  const participantAtas = participants.map((participant) => ata(participant.publicKey));
  const rotatedAta = ata(rotatedWallet.publicKey);

  async function balance(address) {
    return (await getAccount(connection, address, "confirmed", TOKEN_PROGRAM_ID)).amount;
  }
  async function agreementState() {
    return program.account.agreementVersionState.fetch(agreement, "confirmed");
  }

  // --------------------------------------------------- reference model state
  const referenceAgreement = {
    id: agreement.toBase58(),
    version: 1,
    settlementBasis: "REVENUE_PARTICIPATION",
    participants: participants.map((participant, index) => ({
      authority: participant.publicKey.toBytes(),
      shareUnits: shares[index],
    })),
  };
  let referenceState = reference.initialState(referenceAgreement);
  const claimed = participants.map(() => 0n);
  let minted = 0n;
  let pendingInbox = 0n;

  async function assertInvariants(label) {
    const state = await agreementState();
    const gross = bigint(state.cumulativeGross);
    assert.equal(gross, referenceState.gross, `${label}: gross differs from reference engine`);
    let claimedTotal = 0n;
    state.participants.forEach((participant, index) => {
      assert.equal(bigint(participant.cumulativeAllocated), referenceState.allocated[index], `${label}: allocation[${index}] differs from reference engine`);
      assert.equal(bigint(participant.cumulativeClaimed), claimed[index], `${label}: claimed[${index}] mismatch`);
      claimedTotal += claimed[index];
    });
    const inboxBalance = await balance(inbox);
    assert.equal(inboxBalance - (gross - claimedTotal), pendingInbox, `${label}: inbox surplus mismatch`);
    let held = (await balance(funderAta)) + inboxBalance;
    for (const account of [...participantAtas, rotatedAta]) {
      if (await connection.getAccountInfo(account, "confirmed")) held += await balance(account);
    }
    assert.equal(held, minted, `${label}: test tokens not conserved`);
  }

  async function assertAllocation(label, logs, amount, mode, paymentReference) {
    const result = reference.allocate(referenceAgreement, referenceState, { amount });
    const state = await agreementState();
    const [event] = events(logs, "RevenueAllocated");
    assert.ok(event, `${label}: missing RevenueAllocated event`);
    const sequence = bigint(state.allocationSequence);
    assert.equal(bigint(event.data.allocationSequence), sequence);
    assert.equal(bigint(event.data.grossAmount), amount);
    const expectedCommitment = spec.allocationCommitmentV1({
      deploymentId,
      agreement: agreement.toBytes(),
      allocationSequence: sequence,
      mode,
      grossAmount: amount,
      paymentReference: Uint8Array.from(paymentReference),
      allocations: participants.map((participant, index) => ({
        participantAuthority: participant.publicKey.toBytes(),
        allocationAmount: result.allocations[index],
      })),
    });
    assert.equal(
      Buffer.from(event.data.allocationCommitment).toString("hex"),
      spec.bytesToHex(expectedCommitment),
      `${label}: on-chain allocation commitment differs from reference encoding`,
    );
    referenceState = result.nextState;
    return { allocations: result.allocations.map(String), commitment: spec.bytesToHex(expectedCommitment) };
  }

  // --------------------------------------------------------------- lifecycle
  console.log(`lifecycle: ${PARTICIPANT_COUNT} participants`);
  await send(
    "register Work",
    await methods
      .registerWork(workId, wallet.publicKey, workMetadataHash)
      .accountsStrict({ work, originAuthority: wallet.publicKey, systemProgram: SystemProgram.programId })
      .transaction(),
  );
  await send(
    "register RevenuePool",
    await methods
      .registerRevenuePool(poolId, { masterReceipts: {} }, { revenueParticipation: {} }, poolMetadataHash)
      .accountsStrict({ work, revenuePool, manager: wallet.publicKey, systemProgram: SystemProgram.programId })
      .transaction(),
  );
  const participantInputs = participants.map((participant, index) => ({
    participantAuthority: participant.publicKey,
    shareUnits: shares[index],
  }));
  const proposal = await send(
    "propose AgreementVersion v1 (16 participants)",
    await methods
      .proposeAgreement(1, termsHash, participantInputs)
      .accountsStrict({
        config,
        revenuePool,
        agreement,
        manager: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .transaction(),
  );
  assert.equal(events(proposal.logs, "AgreementProposed").length, 1);

  // Participants approve the hash they compute independently, not the stored one.
  const offChainHash = spec.agreementHashV1({
    deploymentId,
    programId: programId.toBytes(),
    revenuePool: revenuePool.toBytes(),
    version: 1,
    predecessorVersion: 0,
    settlementMint: mint.toBytes(),
    tokenProgram: TOKEN_PROGRAM_ID.toBytes(),
    poolKind: spec.RevenuePoolKind.MasterReceipts,
    settlementBasis: spec.SettlementBasis.RevenueParticipation,
    poolMetadataHash: Uint8Array.from(poolMetadataHash),
    termsHash: Uint8Array.from(termsHash),
    participants: participants.map((participant, index) => ({
      participantAuthority: participant.publicKey.toBytes(),
      shareUnits: shares[index],
    })),
  });
  let state = await agreementState();
  assert.equal(
    Buffer.from(state.agreementHash).toString("hex"),
    spec.bytesToHex(offChainHash),
    "on-chain agreement hash differs from the reference encoding",
  );
  for (let index = 0; index < participants.length; index += 1) {
    const { logs } = await send(
      `approve participant ${index}`,
      await methods
        .approveAgreement(Array.from(offChainHash), participants[index].publicKey)
        .accountsStrict({ config, revenuePool, agreement, participant: participants[index].publicKey })
        .transaction(),
      [participants[index]],
    );
    assert.equal(events(logs, "ParticipantApproved").length, 1);
  }
  await send(
    "activate AgreementVersion v1",
    await methods.activateInitialAgreement().accountsStrict({ config, revenuePool, agreement }).transaction(),
  );
  state = await agreementState();
  assert.equal(enumName(state.status), "active");

  await send(
    "initialize Royalty Inbox",
    await methods
      .initializeRoyaltyInbox()
      .accountsStrict({
        config,
        agreement,
        settlementMint: mint,
        vaultAuthority: vault,
        royaltyInbox: inbox,
        payer: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction(),
  );

  // Token accounts and test funds. ATAs are created up front so claims never depend on them.
  const toMint = DIRECT_FUNDING_1 + RAW_DEPOSIT_1 + DIRECT_FUNDING_2;
  const owners = [funder.publicKey, ...participants.map((participant) => participant.publicKey), rotatedWallet.publicKey];
  for (let offset = 0; offset < owners.length; offset += 6) {
    const tx = new Transaction();
    for (const owner of owners.slice(offset, offset + 6)) {
      tx.add(createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata(owner), owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    await send(`create token accounts ${offset}-${Math.min(offset + 6, owners.length) - 1}`, tx);
  }
  await send(
    "mint test settlement tokens to funder",
    new Transaction().add(createMintToCheckedInstruction(mint, funderAta, wallet.publicKey, toMint, USDC_DECIMALS, [], TOKEN_PROGRAM_ID)),
  );
  minted += toMint;
  await assertInvariants("after funding setup");

  function fundTx(amount, nonce, reference) {
    return methods
      .fundAndAllocate(new BN(amount.toString()), new BN(nonce), reference)
      .accountsStrict({
        config,
        agreement,
        settlementMint: mint,
        vaultAuthority: vault,
        royaltyInbox: inbox,
        payerSource: funderAta,
        payer: funder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
  }
  function claimTx(index, destination) {
    return methods
      .claimParticipant(index)
      .accountsStrict({
        config,
        agreement,
        settlementMint: mint,
        vaultAuthority: vault,
        royaltyInbox: inbox,
        payoutDestination: destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .transaction();
  }
  async function claimAll(label, destinations) {
    for (let index = 0; index < participants.length; index += 1) {
      const before = await agreementState();
      const owed = bigint(before.participants[index].cumulativeAllocated) - bigint(before.participants[index].cumulativeClaimed);
      if (owed === 0n) continue;
      const destinationBefore = await balance(destinations[index]);
      const { logs } = await send(`${label}: claim participant ${index}`, await claimTx(index, destinations[index]));
      const [event] = events(logs, "PayoutClaimed");
      assert.ok(event, "missing PayoutClaimed event");
      assert.equal(bigint(event.data.amount), owed, "claim must transfer exactly the remaining entitlement");
      assert.equal((await balance(destinations[index])) - destinationBefore, owed, "payout ATA did not receive the claim");
      const after = await agreementState();
      after.participants.forEach((participant, other) => {
        if (other === index) return;
        assert.equal(
          bigint(participant.cumulativeClaimed),
          bigint(before.participants[other].cumulativeClaimed),
          "a claim altered another participant's claim history",
        );
      });
      claimed[index] += owed;
    }
  }

  const allocationEvidence = [];
  const reference1 = Array.from(randomBytes(32));
  let { logs } = await send("fund_and_allocate #1 (nonce 0)", await fundTx(DIRECT_FUNDING_1, 0, reference1), [funder]);
  allocationEvidence.push({
    step: "fund_and_allocate #1",
    amount: DIRECT_FUNDING_1.toString(),
    paymentReferenceHex: Buffer.from(reference1).toString("hex"),
    ...(await assertAllocation("fund #1", logs, DIRECT_FUNDING_1, spec.AllocationMode.DirectFunding, reference1)),
  });
  state = await agreementState();
  assert.equal(bigint(state.directFundingNonce), 1n);
  assert.equal(bigint(state.allocationSequence), 1n);
  await assertInvariants("after direct funding #1");

  await send(
    "external deposit to Royalty Inbox",
    new Transaction().add(
      createTransferCheckedInstruction(funderAta, mint, inbox, funder.publicKey, RAW_DEPOSIT_1, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
    ),
    [funder],
  );
  pendingInbox += RAW_DEPOSIT_1;
  await assertInvariants("after external deposit");
  ({ logs } = await send(
    "allocate_inbox",
    await methods
      .allocateInbox()
      .accountsStrict({ config, agreement, vaultAuthority: vault, royaltyInbox: inbox, tokenProgram: TOKEN_PROGRAM_ID })
      .transaction(),
  ));
  allocationEvidence.push({
    step: "allocate_inbox",
    amount: RAW_DEPOSIT_1.toString(),
    paymentReferenceHex: "00".repeat(32),
    ...(await assertAllocation("inbox allocation", logs, RAW_DEPOSIT_1, spec.AllocationMode.Inbox, Array(32).fill(0))),
  });
  pendingInbox = 0n;
  state = await agreementState();
  assert.equal(bigint(state.directFundingNonce), 1n, "inbox allocation must not touch the direct-funding nonce");
  assert.equal(bigint(state.allocationSequence), 2n);
  await assertInvariants("after inbox allocation");

  await claimAll("round 1", participantAtas);
  await assertInvariants("after round-1 claims");
  assert.equal(await balance(inbox), 0n);

  const rotatedFrom = participantAtas[0];
  await send(
    "participant 0 rotates payout wallet",
    await methods
      .updatePayoutWallet(rotatedWallet.publicKey)
      .accountsStrict({ agreement, participant: participants[0].publicKey })
      .transaction(),
    [participants[0]],
  );
  state = await agreementState();
  assert.ok(state.participants[0].payoutWallet.equals(rotatedWallet.publicKey));
  assert.equal(state.participants[0].payoutRevision, 2);

  const reference2 = Array.from(randomBytes(32));
  ({ logs } = await send("fund_and_allocate #2 (nonce 1)", await fundTx(DIRECT_FUNDING_2, 1, reference2), [funder]));
  allocationEvidence.push({
    step: "fund_and_allocate #2",
    amount: DIRECT_FUNDING_2.toString(),
    paymentReferenceHex: Buffer.from(reference2).toString("hex"),
    ...(await assertAllocation("fund #2", logs, DIRECT_FUNDING_2, spec.AllocationMode.DirectFunding, reference2)),
  });
  await assertInvariants("after direct funding #2");
  const staleBalance = await balance(rotatedFrom);
  await claimAll("round 2", [rotatedAta, ...participantAtas.slice(1)]);
  assert.equal(await balance(rotatedFrom), staleBalance, "the pre-rotation payout ATA must not receive new claims");
  await assertInvariants("after round-2 claims");

  state = await agreementState();
  const totalDeposited = DIRECT_FUNDING_1 + RAW_DEPOSIT_1 + DIRECT_FUNDING_2;
  assert.equal(bigint(state.cumulativeGross), totalDeposited);
  assert.equal(bigint(state.directFundingNonce), 2n);
  assert.equal(bigint(state.allocationSequence), 3n);
  assert.equal(await balance(inbox), 0n, "every allocated unit was claimed");
  assert.equal(await balance(funderAta), 0n);

  // ----------------------------------------------------------------- evidence
  const computeByStep = {};
  for (const record of transactions) {
    const kind = record.label.replace(/ \d+$/, "").replace(/^round \d+: /, "");
    computeByStep[kind] = Math.max(computeByStep[kind] ?? 0, record.computeUnits ?? 0);
  }
  const evidence = {
    suite: "phase-3d.4-lifecycle",
    cluster,
    genesis,
    generatedAt: new Date().toISOString(),
    program: programEvidence,
    config: configEvidence,
    run: {
      feePayer: wallet.publicKey.toBase58(),
      funder: funder.publicKey.toBase58(),
      funderTokenAccount: funderAta.toBase58(),
      rotatedPayoutWallet: rotatedWallet.publicKey.toBase58(),
      minted: minted.toString(),
      work: work.toBase58(),
      revenuePool: revenuePool.toBase58(),
      agreement: agreement.toBase58(),
      agreementHashHex: spec.bytesToHex(offChainHash),
      vaultAuthority: vault.toBase58(),
      royaltyInbox: inbox.toBase58(),
      participants: participants.map((participant, index) => ({
        authority: participant.publicKey.toBase58(),
        shareUnits: shares[index],
        payoutDestination: index === 0 ? [participantAtas[0].toBase58(), rotatedAta.toBase58()] : participantAtas[index].toBase58(),
        claimed: claimed[index].toString(),
      })),
      allocations: allocationEvidence,
      final: {
        cumulativeGross: bigint(state.cumulativeGross).toString(),
        directFundingNonce: bigint(state.directFundingNonce).toString(),
        allocationSequence: bigint(state.allocationSequence).toString(),
        royaltyInboxBalance: "0",
      },
    },
    maxComputeUnitsByStep: computeByStep,
    maxTransactionBytes: Math.max(...transactions.map((record) => record.transactionBytes)),
    transactions,
    checks: [
      "deployed program bytes equal the local build (when RR_PROGRAM_SO is present)",
      "ProtocolConfig governance/guardian/token program match the expected owner configuration",
      "on-chain agreement hash equals the TypeScript reference encoding",
      "every allocation equals the TypeScript reference allocator, including rounding",
      "every allocation commitment equals the TypeScript reference encoding",
      "direct-funding nonce advanced only on direct funding; allocation sequence on every allocation",
      "each claim moved exactly the remaining entitlement and touched no other participant",
      "post-rotation claims reached only the new canonical ATA",
      "settlement tokens conserved and Royalty Inbox solvent at every checkpoint",
    ],
    status: "PASS",
  };
  const evidencePath =
    process.env.RR_EVIDENCE_PATH ?? `target/e2e/${cluster}-lifecycle-${evidence.generatedAt.replaceAll(":", "-")}.json`;
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`evidence written to ${evidencePath}`);
  console.log(JSON.stringify({ ...evidence, transactions: `${transactions.length} transactions (see evidence file)` }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
