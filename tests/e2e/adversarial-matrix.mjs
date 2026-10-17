// Phase 3D.3 adversarial local-validator matrix.
//
// Every expected rejection is submitted with skipPreflight so it lands on the
// validator as a real failed transaction (fee charged, instruction executed).
// Each case then proves:
//   1. the transaction failed at instruction 0 with the expected error code,
//   2. the failure was raised by the expected program (RoyaltyRail or SPL Token),
//   3. every tracked protocol, SPL token, and mint account is byte-for-byte,
//      owner-for-owner, and lamport-for-lamport identical before and after,
//   4. the only balance change is the fee paid by the transaction fee payer.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import anchor from "@anchor-lang/core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  approve,
  createAccount,
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
} from "@solana/spl-token";

// @anchor-lang/core ships CommonJS to Node; BN is not detectable as a named
// ESM export, so destructure from the default export instead.
const { AnchorProvider, BN, Program, setProvider } = anchor;

const USDC_DECIMALS = 6;
const CONFIG_SEED = Buffer.from("config");
const WORK_SEED = Buffer.from("work");
const POOL_SEED = Buffer.from("pool");
const AGREEMENT_SEED = Buffer.from("agreement");
const VAULT_SEED = Buffer.from("vault");
const U64_MAX = (1n << 64n) - 1n;

// Anchor framework error numbers (@anchor-lang/core 1.2.1 LangErrorCode).
const FRAMEWORK_ERRORS = {
  ConstraintSeeds: 2006,
  AccountDiscriminatorMismatch: 3002,
  AccountOwnedByWrongProgram: 3007,
  InvalidProgramId: 3008,
  AccountNotSigner: 3010,
};
// spl-token TokenError::InsufficientFunds.
const SPL_TOKEN_INSUFFICIENT_FUNDS = 1;

function fixedBytes(value) {
  return Array.from(Buffer.alloc(32, value));
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
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

function derivePdas(programId, origin, workId, poolId, version) {
  const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
  const [work] = PublicKey.findProgramAddressSync(
    [WORK_SEED, origin.toBuffer(), Buffer.from(workId)],
    programId,
  );
  const [revenuePool] = PublicKey.findProgramAddressSync(
    [POOL_SEED, work.toBuffer(), Buffer.from(poolId)],
    programId,
  );
  const [agreement] = PublicKey.findProgramAddressSync(
    [AGREEMENT_SEED, revenuePool.toBuffer(), u32Le(version)],
    programId,
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, agreement.toBuffer()],
    programId,
  );
  return { config, work, revenuePool, agreement, vaultAuthority };
}

function canonicalAta(mint, owner, allowOwnerOffCurve) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

class Harness {
  constructor(connection, program, rawIdl, feePayer) {
    this.connection = connection;
    this.program = program;
    this.feePayer = feePayer;
    this.tracked = new Map();
    this.seenSignatures = new Set();
    this.evidence = [];
    this.assertions = [];
    this.invariantCheckpoints = [];
    // Program camel-cases the IDL; on-chain logs use the raw PascalCase names.
    this.idlErrors = new Map(rawIdl.errors.map((error) => [error.name, error.code]));
  }

  // Positive-path security properties asserted on successful transactions.
  record(id, category, property, observed) {
    this.assertions.push({ id, category, property, observed });
    console.log(`  ASSERTED ${id}: ${observed}`);
  }

  track(label, publicKey) {
    assert.ok(!this.tracked.has(label), `duplicate tracked label ${label}`);
    this.tracked.set(label, publicKey);
  }

  async snapshot() {
    const labels = [...this.tracked.keys()];
    const keys = labels.map((label) => this.tracked.get(label));
    const infos = [];
    for (let offset = 0; offset < keys.length; offset += 100) {
      infos.push(
        ...(await this.connection.getMultipleAccountsInfo(
          keys.slice(offset, offset + 100),
          "confirmed",
        )),
      );
    }
    const snap = new Map();
    labels.forEach((label, index) => {
      const info = infos[index];
      snap.set(
        label,
        info
          ? [
              info.owner.toBase58(),
              info.lamports,
              info.executable,
              Buffer.from(info.data).toString("hex"),
            ].join("|")
          : "<absent>",
      );
    });
    return snap;
  }

  expectedErrorNumber(name) {
    if (name in FRAMEWORK_ERRORS) return FRAMEWORK_ERRORS[name];
    const code = this.idlErrors.get(name);
    assert.ok(code !== undefined, `harness: unknown RoyaltyRail error ${name}`);
    return code;
  }

  async submit(transaction, signers) {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");
    transaction.feePayer = this.feePayer.publicKey;
    transaction.recentBlockhash = blockhash;
    const unique = new Map();
    for (const signer of [this.feePayer, ...signers]) {
      unique.set(signer.publicKey.toBase58(), signer);
    }
    transaction.sign(...unique.values());
    const raw = transaction.serialize();
    const signature = await this.connection.sendRawTransaction(raw, {
      skipPreflight: true,
      maxRetries: 5,
    });
    assert.ok(
      !this.seenSignatures.has(signature),
      `harness: signature ${signature} was already submitted`,
    );
    this.seenSignatures.add(signature);
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    let result = null;
    for (let attempt = 0; attempt < 40 && !result; attempt += 1) {
      result = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!result) await sleep(250);
    }
    assert.ok(result?.meta, `harness: transaction ${signature} not found`);
    return { signature, result, raw };
  }

  async expectSuccess(label, transaction, signers = []) {
    const outcome = await this.submit(transaction, signers);
    if (outcome.result.meta.err) {
      throw new Error(
        `${label} unexpectedly failed: ${JSON.stringify(outcome.result.meta.err)}\n` +
          (outcome.result.meta.logMessages ?? []).join("\n"),
      );
    }
    return outcome;
  }

  // expected:
  //   { error: "<RoyaltyRail or Anchor error name>", account?: "<snake_case account>" }
  //   { splToken: SPL_TOKEN_INSUFFICIENT_FUNDS, log: "<token program log line>" }
  async expectRejection(testCase, buildTransaction, signers, expected) {
    const before = await this.snapshot();
    const transaction = await buildTransaction();
    assert.equal(
      transaction.instructions.length,
      1,
      `${testCase.id}: adversarial transactions must contain exactly one instruction`,
    );
    const { signature, result } = await this.submit(transaction, signers);
    const { meta } = result;
    const logs = meta.logMessages ?? [];

    if (!meta.err) {
      throw new Error(
        `SECURITY FAILURE ${testCase.id}: expected rejection but transaction ${signature} succeeded\n` +
          logs.join("\n"),
      );
    }

    const instructionError = meta.err.InstructionError;
    assert.ok(
      Array.isArray(instructionError),
      `${testCase.id}: expected an InstructionError, got ${JSON.stringify(meta.err)}`,
    );
    assert.equal(instructionError[0], 0, `${testCase.id}: failure must be in instruction 0`);
    const customCode = instructionError[1]?.Custom;

    let observed;
    if (expected.error) {
      const number = this.expectedErrorNumber(expected.error);
      assert.equal(
        customCode,
        number,
        `${testCase.id}: expected ${expected.error} (${number}), got ${JSON.stringify(meta.err)}\n${logs.join("\n")}`,
      );
      assert.ok(
        logs.some((line) =>
          line.includes(`Error Code: ${expected.error}. Error Number: ${number}.`),
        ),
        `${testCase.id}: RoyaltyRail did not log ${expected.error}\n${logs.join("\n")}`,
      );
      if (expected.account) {
        assert.ok(
          logs.some((line) =>
            line.includes(`AnchorError caused by account: ${expected.account}.`),
          ),
          `${testCase.id}: rejection was not attributed to account ${expected.account}\n${logs.join("\n")}`,
        );
      }
      assert.ok(
        logs.some((line) => line.startsWith(`Program ${this.program.programId.toBase58()} failed`)),
        `${testCase.id}: RoyaltyRail program did not report the failure\n${logs.join("\n")}`,
      );
      observed = `${expected.error} (${number})${expected.account ? ` on ${expected.account}` : ""}`;
    } else {
      assert.equal(
        customCode,
        expected.splToken,
        `${testCase.id}: expected SPL Token error ${expected.splToken}, got ${JSON.stringify(meta.err)}\n${logs.join("\n")}`,
      );
      assert.ok(
        logs.some((line) =>
          line.startsWith(
            `Program ${TOKEN_PROGRAM_ID.toBase58()} failed: custom program error: 0x${expected.splToken.toString(16)}`,
          ),
        ),
        `${testCase.id}: SPL Token program did not report the failure\n${logs.join("\n")}`,
      );
      assert.ok(
        logs.some((line) => line.includes(expected.log)),
        `${testCase.id}: missing SPL Token log "${expected.log}"\n${logs.join("\n")}`,
      );
      observed = `SPL Token custom error ${expected.splToken} (${expected.log})`;
    }

    // The fee payer is the transaction's first account; its only balance change
    // must be the network fee. Fees are not protocol-state mutation.
    assert.ok(meta.fee > 0, `${testCase.id}: failed transaction must have been charged a fee`);
    assert.equal(
      meta.preBalances[0] - meta.postBalances[0],
      meta.fee,
      `${testCase.id}: fee payer balance changed by more than the fee\n` +
        JSON.stringify({
          keys: result.transaction.message.staticAccountKeys?.map((key) => key.toBase58()),
          pre: meta.preBalances,
          post: meta.postBalances,
          fee: meta.fee,
          costUnits: meta.costUnits,
          computeUnitsConsumed: meta.computeUnitsConsumed,
        }),
    );

    const after = await this.snapshot();
    const mutated = [...before.keys()].filter((label) => before.get(label) !== after.get(label));
    assert.deepEqual(
      mutated,
      [],
      `${testCase.id}: failed transaction mutated tracked accounts: ${mutated.join(", ")}`,
    );

    this.evidence.push({
      ...testCase,
      expected: expected.error ?? `spl-token:${expected.splToken}`,
      observed,
      signature,
      slot: result.slot,
      feeLamports: meta.fee,
      accountsUnchanged: before.size,
    });
    console.log(`  REJECTED ${testCase.id}: ${observed}; ${before.size} tracked accounts unchanged`);
  }
}

async function main() {
  const provider = AnchorProvider.env();
  setProvider(provider);
  const connection = provider.connection;
  const governance = loadKeypair(process.env.ANCHOR_WALLET);
  assert.ok(
    provider.publicKey.equals(governance.publicKey),
    "Anchor provider wallet must match ANCHOR_WALLET",
  );

  const idl = JSON.parse(readFileSync("target/idl/royaltyrail.json", "utf8"));
  const program = new Program(idl, provider);
  const programId = program.programId;
  // Dedicated fee payer: the validator mint wallet holds more lamports than a JS
  // number represents exactly, which would make fee accounting imprecise.
  const relayer = Keypair.generate();
  const h = new Harness(connection, program, idl, relayer);
  const methods = program.methods;

  const participants = [Keypair.generate(), Keypair.generate()].sort((a, b) =>
    Buffer.compare(a.publicKey.toBuffer(), b.publicKey.toBuffer()),
  );
  const [p0, p1] = participants;
  const guardian = Keypair.generate();
  const funder = Keypair.generate();
  const victim = Keypair.generate();
  const attacker = Keypair.generate();
  const rotatedWallet = Keypair.generate();

  for (const [keypair, sol] of [[relayer, 20], [guardian, 2], [p0, 2], [p1, 2], [funder, 2], [victim, 2], [attacker, 2]]) {
    const signature = await connection.requestAirdrop(keypair.publicKey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature, "confirmed");
  }

  // ---------------------------------------------------------------- fixtures
  const confirm = { commitment: "confirmed" };
  const mint = await createMint(connection, governance, governance.publicKey, null, USDC_DECIMALS, undefined, confirm, TOKEN_PROGRAM_ID);
  const otherMint = await createMint(connection, governance, governance.publicKey, null, USDC_DECIMALS, undefined, confirm, TOKEN_PROGRAM_ID);
  const nineDecimalMint = await createMint(connection, governance, governance.publicKey, null, 9, undefined, confirm, TOKEN_PROGRAM_ID);
  const token2022Mint = await createMint(connection, governance, governance.publicKey, null, USDC_DECIMALS, undefined, confirm, TOKEN_2022_PROGRAM_ID);

  async function ata(tokenMint, owner, allowOwnerOffCurve = false) {
    const account = await getOrCreateAssociatedTokenAccount(
      connection, governance, tokenMint, owner, allowOwnerOffCurve, "confirmed", confirm,
      TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return account.address;
  }
  async function mintUnits(tokenMint, destination, amount) {
    await mintTo(connection, governance, tokenMint, destination, governance, amount, [], confirm, TOKEN_PROGRAM_ID);
  }
  async function deposit(source, owner, destination, amount) {
    await transferChecked(connection, governance, source, mint, destination, owner, amount, USDC_DECIMALS, [], confirm, TOKEN_PROGRAM_ID);
  }

  const funderAta = await ata(mint, funder.publicKey);
  const funderOtherAta = await ata(otherMint, funder.publicKey);
  const victimAta = await ata(mint, victim.publicKey);
  const attackerAta = await ata(mint, attacker.publicKey);
  const p0Ata = await ata(mint, p0.publicKey);
  const p1Ata = await ata(mint, p1.publicKey);
  const rotatedAta = await ata(mint, rotatedWallet.publicKey);
  const p1OtherMintAta = await ata(otherMint, p1.publicKey);
  const p1NonCanonical = await createAccount(connection, governance, mint, p1.publicKey, Keypair.generate(), confirm, TOKEN_PROGRAM_ID);
  await mintUnits(mint, funderAta, 20_000_000n);
  await mintUnits(mint, victimAta, 5_000_000n);
  await mintUnits(mint, attackerAta, 1_000_000n);
  await mintUnits(otherMint, funderOtherAta, 5_000_000n);

  const workId = fixedBytes(0x21);
  const poolId = fixedBytes(0x31);
  const v1 = derivePdas(programId, governance.publicKey, workId, poolId, 1);
  const v2 = derivePdas(programId, governance.publicKey, workId, poolId, 2);
  const inboxV1 = canonicalAta(mint, v1.vaultAuthority, true);
  const inboxV2 = canonicalAta(mint, v2.vaultAuthority, true);

  // Every account whose bytes a failed transaction must not change.
  h.track("config", v1.config);
  h.track("work", v1.work);
  h.track("revenuePool", v1.revenuePool);
  h.track("agreementV1", v1.agreement);
  h.track("agreementV2", v2.agreement);
  h.track("vaultV1", v1.vaultAuthority);
  h.track("vaultV2", v2.vaultAuthority);
  h.track("inboxV1", inboxV1);
  h.track("inboxV2", inboxV2);
  h.track("funderAta", funderAta);
  h.track("funderOtherMintAta", funderOtherAta);
  h.track("victimAta", victimAta);
  h.track("attackerAta", attackerAta);
  h.track("p0Ata", p0Ata);
  h.track("p1Ata", p1Ata);
  h.track("rotatedAta", rotatedAta);
  h.track("p1OtherMintAta", p1OtherMintAta);
  h.track("p1NonCanonicalAccount", p1NonCanonical);
  h.track("settlementMint", mint);
  h.track("otherMint", otherMint);
  h.track("nineDecimalMint", nineDecimalMint);
  h.track("token2022Mint", token2022Mint);

  // Settlement-mint token accounts used for exact conservation checks.
  const settlementAccounts = [
    funderAta, victimAta, attackerAta, p0Ata, p1Ata, rotatedAta, p1NonCanonical, inboxV1, inboxV2,
  ];
  let pendingInboxV1 = 0n; // raw deposits not yet allocated

  async function agreementState(address) {
    return program.account.agreementVersionState.fetch(address, "confirmed");
  }
  async function balance(address) {
    return (await getAccount(connection, address, "confirmed", TOKEN_PROGRAM_ID)).amount;
  }

  async function assertInvariants(label) {
    const agreement = await agreementState(v1.agreement);
    const gross = bigint(agreement.cumulativeGross);
    let allocated = 0n;
    let claimed = 0n;
    for (const participant of agreement.participants) {
      const participantAllocated = bigint(participant.cumulativeAllocated);
      const participantClaimed = bigint(participant.cumulativeClaimed);
      assert.ok(participantClaimed <= participantAllocated, `${label}: claimed exceeds allocated`);
      allocated += participantAllocated;
      claimed += participantClaimed;
    }
    assert.equal(allocated, gross, `${label}: allocated total must equal cumulative gross`);
    const inbox = await balance(inboxV1);
    const liabilities = gross - claimed;
    assert.ok(inbox >= liabilities, `${label}: Royalty Inbox is insolvent`);
    assert.equal(inbox - liabilities, pendingInboxV1, `${label}: unexpected unallocated inbox balance`);

    const supply = (await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID)).supply;
    let held = 0n;
    for (const account of settlementAccounts) {
      const info = await connection.getAccountInfo(account, "confirmed");
      if (info) held += await balance(account);
    }
    assert.equal(held, supply, `${label}: settlement tokens are not conserved`);
    h.invariantCheckpoints.push(label);
  }

  async function participantBytes(index) {
    const agreement = await agreementState(v1.agreement);
    return JSON.stringify(agreement.participants[index], (_, value) =>
      value instanceof PublicKey ? value.toBase58() : BN.isBN(value) ? value.toString() : value,
    );
  }

  // ------------------------------------------------ instruction builders
  function fundTx(amount, nonce, overrides = {}, reference = 0x81) {
    return methods
      .fundAndAllocate(new BN(amount.toString()), new BN(nonce.toString()), fixedBytes(reference))
      .accountsStrict({
        config: v1.config,
        agreement: v1.agreement,
        settlementMint: mint,
        vaultAuthority: v1.vaultAuthority,
        royaltyInbox: inboxV1,
        payerSource: funderAta,
        payer: funder.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...overrides,
      })
      .transaction();
  }
  function allocateTx(overrides = {}) {
    return methods
      .allocateInbox()
      .accountsStrict({
        config: v1.config,
        agreement: v1.agreement,
        vaultAuthority: v1.vaultAuthority,
        royaltyInbox: inboxV1,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...overrides,
      })
      .transaction();
  }
  function claimTx(index, payoutDestination, overrides = {}) {
    return methods
      .claimParticipant(index)
      .accountsStrict({
        config: v1.config,
        agreement: v1.agreement,
        settlementMint: mint,
        vaultAuthority: v1.vaultAuthority,
        royaltyInbox: inboxV1,
        payoutDestination,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...overrides,
      })
      .transaction();
  }
  function initInboxTx(overrides = {}) {
    return methods
      .initializeRoyaltyInbox()
      .accountsStrict({
        config: v1.config,
        agreement: v1.agreement,
        settlementMint: mint,
        vaultAuthority: v1.vaultAuthority,
        royaltyInbox: inboxV1,
        payer: relayer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        ...overrides,
      })
      .transaction();
  }
  function initConfigTx(settlementMint, tokenProgram) {
    return methods
      .initializeConfig(fixedBytes(0x71), guardian.publicKey)
      .accountsStrict({
        config: v1.config,
        governanceAuthority: governance.publicKey,
        settlementMint,
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
  }
  function pauseTx(authority, agreements, allocations, claims) {
    return methods
      .guardianPause(agreements, allocations, claims)
      .accountsStrict({ config: v1.config, authority })
      .transaction();
  }
  function setPausesTx(authority, agreements, allocations, claims) {
    return methods
      .governanceSetPauses(agreements, allocations, claims)
      .accountsStrict({ config: v1.config, authority })
      .transaction();
  }
  const rejectCase = (id, category, threat) => ({ id, category, threat });

  // ================================================== Config initialization
  console.log("Config initialization guards");
  await h.expectRejection(
    rejectCase("CFG-01", "A", "ProtocolConfig bound to Token-2022 program and mint"),
    () => initConfigTx(token2022Mint, TOKEN_2022_PROGRAM_ID),
    [governance],
    { error: "InvalidTokenProgram" },
  );
  await h.expectRejection(
    rejectCase("CFG-02", "A", "ProtocolConfig bound to a Token-2022 mint under the legacy program id"),
    () => initConfigTx(token2022Mint, TOKEN_PROGRAM_ID),
    [governance],
    { error: "InvalidSettlementMintOwner" },
  );
  await h.expectRejection(
    rejectCase("CFG-03", "A", "ProtocolConfig bound to a non-six-decimal settlement mint"),
    () => initConfigTx(nineDecimalMint, TOKEN_PROGRAM_ID),
    [governance],
    { error: "InvalidSettlementMintDecimals" },
  );
  await h.expectSuccess("initialize config", await initConfigTx(mint, TOKEN_PROGRAM_ID), [governance]);

  // ===================================================== Agreement fixture
  await h.expectSuccess(
    "register work",
    await methods
      .registerWork(workId, governance.publicKey, fixedBytes(0x41))
      .accountsStrict({ work: v1.work, originAuthority: governance.publicKey, systemProgram: SystemProgram.programId })
      .transaction(),
    [governance],
  );
  await h.expectSuccess(
    "register revenue pool",
    await methods
      .registerRevenuePool(poolId, { masterReceipts: {} }, { revenueParticipation: {} }, fixedBytes(0x51))
      .accountsStrict({ work: v1.work, revenuePool: v1.revenuePool, manager: governance.publicKey, systemProgram: SystemProgram.programId })
      .transaction(),
    [governance],
  );
  const participantInputs = [
    { participantAuthority: p0.publicKey, shareUnits: 60_000_000 },
    { participantAuthority: p1.publicKey, shareUnits: 40_000_000 },
  ];
  async function propose(pdas, version, termsByte) {
    await h.expectSuccess(
      `propose v${version}`,
      await methods
        .proposeAgreement(version, fixedBytes(termsByte), participantInputs)
        .accountsStrict({
          config: pdas.config,
          revenuePool: pdas.revenuePool,
          agreement: pdas.agreement,
          manager: governance.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
      [governance],
    );
    return Array.from((await agreementState(pdas.agreement)).agreementHash);
  }
  function approveTx(pdas, hash, signer, payoutWallet) {
    return methods
      .approveAgreement(hash, payoutWallet)
      .accountsStrict({ config: pdas.config, revenuePool: pdas.revenuePool, agreement: pdas.agreement, participant: signer })
      .transaction();
  }

  const hashV1 = await propose(v1, 1, 0x61);
  await h.expectSuccess("approve p0", await approveTx(v1, hashV1, p0.publicKey, p0.publicKey), [p0]);
  await h.expectSuccess("approve p1", await approveTx(v1, hashV1, p1.publicKey, p1.publicKey), [p1]);
  await h.expectSuccess(
    "activate v1",
    await methods
      .activateInitialAgreement()
      .accountsStrict({ config: v1.config, revenuePool: v1.revenuePool, agreement: v1.agreement })
      .transaction(),
  );

  // Royalty Inbox initialization guards run before the canonical inbox exists.
  console.log("Royalty Inbox initialization guards");
  await h.expectRejection(
    rejectCase("INIT-01", "A", "initialize inbox with a non-settlement mint"),
    () => initInboxTx({ settlementMint: otherMint, royaltyInbox: canonicalAta(otherMint, v1.vaultAuthority, true) }),
    [],
    { error: "SettlementConfigMismatch", account: "settlement_mint" },
  );
  await h.expectRejection(
    rejectCase("INIT-02", "A", "initialize inbox through Token-2022"),
    () => initInboxTx({ tokenProgram: TOKEN_2022_PROGRAM_ID }),
    [],
    { error: "InvalidProgramId", account: "token_program" },
  );
  await h.expectRejection(
    rejectCase("INIT-03", "A", "initialize inbox with a non-canonical vault PDA"),
    () => initInboxTx({ vaultAuthority: attacker.publicKey }),
    [],
    { error: "ConstraintSeeds", account: "vault_authority" },
  );
  await h.expectRejection(
    rejectCase("INIT-04", "A", "initialize a non-canonical Royalty Inbox address"),
    () => initInboxTx({ royaltyInbox: Keypair.generate().publicKey }),
    [],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectSuccess("initialize inbox v1", await initInboxTx());

  // Substitution fixtures, created after the canonical inbox exists.
  const decoyInbox = await createAccount(connection, governance, mint, v1.vaultAuthority, Keypair.generate(), confirm, TOKEN_PROGRAM_ID);
  const vaultOtherMintAta = await createAssociatedTokenAccountIdempotent(
    connection, governance, otherMint, v1.vaultAuthority, confirm, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true,
  );
  const vaultToken2022Account = await createAccount(connection, governance, token2022Mint, v1.vaultAuthority, Keypair.generate(), confirm, TOKEN_2022_PROGRAM_ID);
  await deposit(attackerAta, attacker, decoyInbox, 300_000n);
  await transferChecked(connection, governance, funderOtherAta, otherMint, vaultOtherMintAta, funder, 250_000n, USDC_DECIMALS, [], confirm, TOKEN_PROGRAM_ID);
  h.track("decoyInbox", decoyInbox);
  h.track("vaultOtherMintAta", vaultOtherMintAta);
  h.track("vaultToken2022Account", vaultToken2022Account);
  settlementAccounts.push(decoyInbox);
  await assertInvariants("after fixture setup");

  // ============================================ Legitimate direct funding
  const funding1 = await h.expectSuccess("fund_and_allocate #1", await fundTx(1_000_000n, 0n), [funder]);
  let agreement = await agreementState(v1.agreement);
  assert.equal(bigint(agreement.directFundingNonce), 1n);
  assert.equal(bigint(agreement.allocationSequence), 1n);
  assert.equal(bigint(agreement.participants[0].cumulativeAllocated), 600_000n);
  assert.equal(bigint(agreement.participants[1].cumulativeAllocated), 400_000n);
  await assertInvariants("after funding #1");

  // ======================================================= B. Replay
  console.log("B. Replay and duplicate execution");
  {
    // Exact replay of an already-landed signed transaction.
    const before = await h.snapshot();
    let replayError;
    try {
      await connection.sendRawTransaction(funding1.raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
    } catch (error) {
      replayError = error;
    }
    assert.ok(replayError, "SECURITY FAILURE REPLAY-01: identical signed transaction was accepted again");
    assert.match(String(replayError.message), /already been processed/i);
    await sleep(1_000);
    const after = await h.snapshot();
    const mutated = [...before.keys()].filter((label) => before.get(label) !== after.get(label));
    assert.deepEqual(mutated, [], `REPLAY-01 mutated ${mutated.join(", ")}`);
    agreement = await agreementState(v1.agreement);
    assert.equal(bigint(agreement.directFundingNonce), 1n);
    assert.equal(bigint(agreement.allocationSequence), 1n);
    h.evidence.push({
      id: "REPLAY-01",
      category: "B",
      threat: "byte-identical replay of a landed fund_and_allocate transaction",
      expected: "runtime AlreadyProcessed",
      observed: "rejected by validator: transaction already processed",
      signature: funding1.signature,
      accountsUnchanged: before.size,
    });
    console.log(`  REJECTED REPLAY-01: runtime AlreadyProcessed; ${before.size} tracked accounts unchanged`);
  }
  await h.expectRejection(
    rejectCase("REPLAY-02", "B", "reuse consumed direct-funding nonce 0"),
    () => fundTx(1_000_000n, 0n, {}, 0x82),
    [funder],
    { error: "DirectFundingNonceMismatch" },
  );
  await h.expectRejection(
    rejectCase("REPLAY-03", "B", "skip ahead to a future direct-funding nonce"),
    () => fundTx(1_000_000n, 7n),
    [funder],
    { error: "DirectFundingNonceMismatch" },
  );
  await h.expectRejection(
    rejectCase("REPLAY-04", "B", "allocate an inbox whose balance is already fully allocated"),
    () => allocateTx(),
    [],
    { error: "NoUnallocatedInboxFunds" },
  );
  await deposit(funderAta, funder, inboxV1, 500_000n);
  pendingInboxV1 += 500_000n;
  await assertInvariants("after raw deposit #1");
  await h.expectSuccess("allocate_inbox #1", await allocateTx());
  pendingInboxV1 = 0n;
  await assertInvariants("after inbox allocation #1");
  await h.expectRejection(
    rejectCase("REPLAY-05", "B", "double-allocate the same raw deposit"),
    () => allocateTx(),
    [],
    { error: "NoUnallocatedInboxFunds" },
  );
  agreement = await agreementState(v1.agreement);
  assert.equal(bigint(agreement.cumulativeGross), 1_500_000n);
  assert.equal(bigint(agreement.directFundingNonce), 1n, "inbox allocation must not touch the direct nonce");
  assert.equal(bigint(agreement.allocationSequence), 2n);

  // ============================================== A. Substitution matrix
  console.log("A. Token and account substitution");
  await h.expectRejection(
    rejectCase("SUB-01", "A", "fund_and_allocate with a non-settlement mint"),
    () => fundTx(1_000_000n, 1n, { settlementMint: otherMint }),
    [funder],
    { error: "SettlementConfigMismatch", account: "settlement_mint" },
  );
  await h.expectRejection(
    rejectCase("SUB-02", "A", "claim with a non-settlement mint"),
    () => claimTx(0, p0Ata, { settlementMint: otherMint }),
    [],
    { error: "SettlementConfigMismatch", account: "settlement_mint" },
  );
  await h.expectRejection(
    rejectCase("SUB-03", "A", "fund_and_allocate through Token-2022"),
    () => fundTx(1_000_000n, 1n, { tokenProgram: TOKEN_2022_PROGRAM_ID }),
    [funder],
    { error: "InvalidProgramId", account: "token_program" },
  );
  await h.expectRejection(
    rejectCase("SUB-04", "A", "allocate_inbox through Token-2022"),
    () => allocateTx({ tokenProgram: TOKEN_2022_PROGRAM_ID }),
    [],
    { error: "InvalidProgramId", account: "token_program" },
  );
  await h.expectRejection(
    rejectCase("SUB-05", "A", "claim through Token-2022"),
    () => claimTx(0, p0Ata, { tokenProgram: TOKEN_2022_PROGRAM_ID }),
    [],
    { error: "InvalidProgramId", account: "token_program" },
  );
  await h.expectRejection(
    rejectCase("SUB-06", "A", "fund into a vault-owned Token-2022 account"),
    () => fundTx(1_000_000n, 1n, { royaltyInbox: vaultToken2022Account }),
    [funder],
    { error: "AccountOwnedByWrongProgram", account: "royalty_inbox" },
  );
  await h.expectRejection(
    rejectCase("SUB-07", "A", "claim from a vault-owned Token-2022 account"),
    () => claimTx(0, p0Ata, { royaltyInbox: vaultToken2022Account }),
    [],
    { error: "AccountOwnedByWrongProgram", account: "royalty_inbox" },
  );
  await h.expectRejection(
    rejectCase("SUB-08", "A", "fund_and_allocate with an attacker key as vault PDA"),
    () => fundTx(1_000_000n, 1n, { vaultAuthority: attacker.publicKey }),
    [funder],
    { error: "ConstraintSeeds", account: "vault_authority" },
  );
  await h.expectRejection(
    rejectCase("SUB-09", "A", "claim signed by another agreement's vault PDA"),
    () => claimTx(0, p0Ata, { vaultAuthority: v2.vaultAuthority }),
    [],
    { error: "ConstraintSeeds", account: "vault_authority" },
  );
  await h.expectRejection(
    rejectCase("SUB-10", "A", "allocate_inbox with a wrong-seed vault PDA"),
    () =>
      allocateTx({
        vaultAuthority: PublicKey.findProgramAddressSync([VAULT_SEED, v1.revenuePool.toBuffer()], programId)[0],
      }),
    [],
    { error: "ConstraintSeeds", account: "vault_authority" },
  );
  await h.expectRejection(
    rejectCase("SUB-11", "A/E", "fund into a vault-owned, settlement-mint, non-canonical decoy inbox"),
    () => fundTx(1_000_000n, 1n, { royaltyInbox: decoyInbox }),
    [funder],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectRejection(
    rejectCase("SUB-12", "A/E", "allocate a funded decoy inbox (would inflate gross without canonical funds)"),
    () => allocateTx({ royaltyInbox: decoyInbox }),
    [],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectRejection(
    rejectCase("SUB-13", "A", "claim out of a funded decoy inbox"),
    () => claimTx(0, p0Ata, { royaltyInbox: decoyInbox }),
    [],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectRejection(
    rejectCase("SUB-14", "A", "Royalty Inbox with the wrong mint (vault ATA of another mint)"),
    () => allocateTx({ royaltyInbox: vaultOtherMintAta }),
    [],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectRejection(
    rejectCase("SUB-15", "A", "Royalty Inbox with the wrong token authority (attacker-owned account)"),
    () => allocateTx({ royaltyInbox: attackerAta }),
    [],
    { error: "InvalidRoyaltyInboxAddress" },
  );
  await h.expectRejection(
    rejectCase("SUB-16", "A", "fund_and_allocate from a payer source of another mint"),
    () => fundTx(1_000_000n, 1n, { payerSource: funderOtherAta }),
    [funder],
    { error: "InvalidPayerSourceMint" },
  );
  await h.expectRejection(
    rejectCase("SUB-17", "A/D", "fund_and_allocate from a victim's account signed by another payer"),
    () => fundTx(1_000_000n, 1n, { payerSource: victimAta }),
    [funder],
    { error: "InvalidPayerSourceAuthority" },
  );
  await approve(connection, governance, victimAta, funder.publicKey, victim, 2_000_000n, [], confirm, TOKEN_PROGRAM_ID);
  await h.expectRejection(
    rejectCase("SUB-18", "A/D", "fund_and_allocate using an SPL delegate approval on a victim account"),
    () => fundTx(1_000_000n, 1n, { payerSource: victimAta }),
    [funder],
    { error: "InvalidPayerSourceAuthority" },
  );
  await h.expectRejection(
    rejectCase("SUB-19", "A/D", "fund_and_allocate naming the source owner as payer without its signature"),
    async () => {
      const ix = await methods
        .fundAndAllocate(new BN(1_000_000), new BN(1), fixedBytes(0x83))
        .accountsStrict({
          config: v1.config,
          agreement: v1.agreement,
          settlementMint: mint,
          vaultAuthority: v1.vaultAuthority,
          royaltyInbox: inboxV1,
          payerSource: victimAta,
          payer: victim.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      ix.keys = ix.keys.map((meta) =>
        meta.pubkey.equals(victim.publicKey) ? { ...meta, isSigner: false } : meta,
      );
      return new Transaction().add(ix);
    },
    [],
    { error: "AccountNotSigner", account: "payer" },
  );
  await h.expectRejection(
    rejectCase("SUB-20", "D", "claim with a substituted ProtocolConfig account"),
    () => claimTx(0, p0Ata, { config: v1.revenuePool }),
    [],
    { error: "AccountDiscriminatorMismatch", account: "config" },
  );
  await assertInvariants("after substitution matrix");

  // ======================================== C. Participant payout security
  console.log("C. Participant payout security");
  const p1Before = await participantBytes(1);
  await h.expectSuccess("claim p0 #1", await claimTx(0, p0Ata));
  assert.equal(await balance(p0Ata), 900_000n);
  assert.equal(await participantBytes(1), p1Before, "p0 claim must not alter p1 state");
  h.record("ISO-01", "C", "a claim for p0 cannot alter p1 allocation or claim history", "p1 participant state byte-identical across p0 claim");
  h.record("ENT-01", "C/E", "a claim transfers exactly the remaining entitlement", "p0 received 900000 = cumulative_allocated - cumulative_claimed");
  await assertInvariants("after p0 claim #1");
  await h.expectRejection(
    rejectCase("REPLAY-06", "B/D", "re-claim an amount already claimed"),
    () => claimTx(0, p0Ata),
    [],
    { error: "NoClaimableAmount" },
  );
  await h.expectRejection(
    rejectCase("PAY-01", "C", "route p1's claim into p0's canonical ATA"),
    () => claimTx(1, p0Ata),
    [],
    { error: "InvalidPayoutDestinationAddress" },
  );
  await h.expectRejection(
    rejectCase("PAY-02", "C", "route p1's claim into an attacker ATA"),
    () => claimTx(1, attackerAta),
    [],
    { error: "InvalidPayoutDestinationAddress" },
  );
  await h.expectRejection(
    rejectCase("PAY-03", "C", "route p1's claim into p1's ATA of another mint"),
    () => claimTx(1, p1OtherMintAta),
    [],
    { error: "InvalidPayoutDestinationAddress" },
  );
  await h.expectRejection(
    rejectCase("PAY-04", "C", "route p1's claim into a non-ATA account p1 owns"),
    () => claimTx(1, p1NonCanonical),
    [],
    { error: "InvalidPayoutDestinationAddress" },
  );
  await h.expectRejection(
    rejectCase("PAY-05", "C", "claim for participant index outside the set (2)"),
    () => claimTx(2, p1Ata),
    [],
    { error: "InvalidParticipantIndex" },
  );
  await h.expectRejection(
    rejectCase("PAY-06", "C", "claim for participant index 255"),
    () => claimTx(255, p1Ata),
    [],
    { error: "InvalidParticipantIndex" },
  );
  const p0Before = await participantBytes(0);
  await h.expectSuccess("claim p1 #1", await claimTx(1, p1Ata));
  assert.equal(await balance(p1Ata), 600_000n);
  assert.equal(await participantBytes(0), p0Before, "p1 claim must not alter p0 state");
  h.record("ISO-02", "C", "a claim for p1 cannot alter p0 allocation or claim history", "p0 participant state byte-identical across p1 claim");
  await assertInvariants("after p1 claim #1");

  await h.expectRejection(
    rejectCase("PAY-07", "C/D", "non-participant rotates a payout wallet"),
    () =>
      methods
        .updatePayoutWallet(attacker.publicKey)
        .accountsStrict({ agreement: v1.agreement, participant: attacker.publicKey })
        .transaction(),
    [attacker],
    { error: "ParticipantNotFound" },
  );
  await h.expectSuccess(
    "rotate p0 payout wallet",
    await methods
      .updatePayoutWallet(rotatedWallet.publicKey)
      .accountsStrict({ agreement: v1.agreement, participant: p0.publicKey })
      .transaction(),
    [p0],
  );
  await h.expectSuccess("fund_and_allocate #2", await fundTx(1_000_000n, 1n, {}, 0x84), [funder]);
  await assertInvariants("after funding #2");
  await h.expectRejection(
    rejectCase("PAY-08", "C", "claim to p0's stale pre-rotation ATA"),
    () => claimTx(0, p0Ata),
    [],
    { error: "InvalidPayoutDestinationAddress" },
  );
  await h.expectSuccess("claim p0 to rotated ATA", await claimTx(0, rotatedAta));
  assert.equal(await balance(rotatedAta), 600_000n);
  assert.equal(await balance(p0Ata), 900_000n, "stale route must not receive post-rotation claims");
  h.record("ROUTE-01", "C", "post-rotation claims route only to the new canonical ATA", "rotated ATA +600000; stale ATA unchanged at 900000");
  await h.expectRejection(
    rejectCase("PAY-09", "C/E", "claim beyond remaining entitlement (no amount parameter exists)"),
    () => claimTx(0, rotatedAta),
    [],
    { error: "NoClaimableAmount" },
  );
  await assertInvariants("after payout matrix");

  // ======================================== D. Pauses and authorization
  console.log("D. Authorization and protocol state");
  await h.expectRejection(
    rejectCase("AUTH-01", "D", "non-guardian pauses claims"),
    () => pauseTx(attacker.publicKey, false, false, true),
    [attacker],
    { error: "Unauthorized" },
  );
  await h.expectSuccess("guardian pauses claims", await pauseTx(guardian.publicKey, false, false, true), [guardian]);
  await h.expectRejection(
    rejectCase("PAUSE-01", "D", "claim while claims are paused"),
    () => claimTx(1, p1Ata),
    [],
    { error: "ClaimsPaused" },
  );
  await h.expectRejection(
    rejectCase("AUTH-02", "D", "guardian attempts governance-only unpause"),
    () => setPausesTx(guardian.publicKey, false, false, false),
    [guardian],
    { error: "Unauthorized" },
  );
  await h.expectRejection(
    rejectCase("AUTH-03", "D", "attacker attempts governance-only unpause"),
    () => setPausesTx(attacker.publicKey, false, false, false),
    [attacker],
    { error: "Unauthorized" },
  );
  // Pause domains are independent: allocation still works while claims are paused.
  await deposit(funderAta, funder, inboxV1, 200_000n);
  pendingInboxV1 += 200_000n;
  await h.expectSuccess("allocate_inbox while claims paused", await allocateTx());
  pendingInboxV1 = 0n;
  await assertInvariants("after allocation during claim pause");
  h.record("PAUSE-SEP-01", "D", "a claims pause does not block allocation", "allocate_inbox succeeded while claims_paused = true");

  await h.expectSuccess("governance unpauses", await setPausesTx(governance.publicKey, false, false, false), [governance]);
  await h.expectSuccess("guardian pauses allocations", await pauseTx(guardian.publicKey, false, true, false), [guardian]);
  await h.expectRejection(
    rejectCase("PAUSE-02", "D", "fund_and_allocate while allocations are paused"),
    () => fundTx(1_000_000n, 2n, {}, 0x85),
    [funder],
    { error: "AllocationsPaused" },
  );
  await deposit(funderAta, funder, inboxV1, 100_000n);
  pendingInboxV1 += 100_000n;
  await h.expectRejection(
    rejectCase("PAUSE-03", "D", "allocate_inbox while allocations are paused"),
    () => allocateTx(),
    [],
    { error: "AllocationsPaused" },
  );
  // Claims still work while allocations are paused.
  await h.expectSuccess("claim p1 while allocations paused", await claimTx(1, p1Ata));
  assert.equal(await balance(p1Ata), 1_080_000n);
  await assertInvariants("after claim during allocation pause");
  h.record("PAUSE-SEP-02", "D", "an allocations pause does not block claims", "p1 claim succeeded while allocations_paused = true");
  await h.expectSuccess("governance unpauses", await setPausesTx(governance.publicKey, false, false, false), [governance]);
  await h.expectSuccess("allocate_inbox after unpause", await allocateTx());
  pendingInboxV1 = 0n;
  await h.expectSuccess("claim p0 remaining", await claimTx(0, rotatedAta));
  await h.expectSuccess("claim p1 remaining", await claimTx(1, p1Ata));
  agreement = await agreementState(v1.agreement);
  assert.equal(bigint(agreement.cumulativeGross), 2_800_000n);
  assert.equal(bigint(agreement.directFundingNonce), 2n);
  assert.equal(bigint(agreement.allocationSequence), 5n);
  assert.equal(bigint(agreement.participants[0].cumulativeClaimed), 1_680_000n);
  assert.equal(bigint(agreement.participants[1].cumulativeClaimed), 1_120_000n);
  assert.equal(await balance(inboxV1), 0n);
  await assertInvariants("after full settlement");
  await h.expectRejection(
    rejectCase("STATE-01", "D", "claim for fully claimed participant 0"),
    () => claimTx(0, rotatedAta),
    [],
    { error: "NoClaimableAmount" },
  );
  await h.expectRejection(
    rejectCase("STATE-02", "D", "claim for fully claimed participant 1"),
    () => claimTx(1, p1Ata),
    [],
    { error: "NoClaimableAmount" },
  );

  // ============================================ E. Accounting and solvency
  console.log("E. Accounting and solvency");
  await h.expectRejection(
    rejectCase("ACCT-01", "E", "zero-amount direct funding"),
    () => fundTx(0n, 2n, {}, 0x86),
    [funder],
    { error: "AllocationAmountZero" },
  );
  const funderBalance = await balance(funderAta);
  await h.expectRejection(
    rejectCase("ACCT-02", "E", "allocate more than the payer actually deposits (balance + 1)"),
    () => fundTx(funderBalance + 1n, 2n, {}, 0x87),
    [funder],
    { splToken: SPL_TOKEN_INSUFFICIENT_FUNDS, log: "Error: insufficient funds" },
  );
  await h.expectRejection(
    rejectCase("ACCT-03", "E", "allocate u64::MAX without funds"),
    () => fundTx(U64_MAX, 2n, {}, 0x88),
    [funder],
    { splToken: SPL_TOKEN_INSUFFICIENT_FUNDS, log: "Error: insufficient funds" },
  );
  await assertInvariants("after accounting matrix");

  // ======================================== D. Non-settleable agreements
  console.log("D. Non-settleable agreement states");
  const hashV2 = await propose(v2, 2, 0x62);
  assert.equal(enumName((await agreementState(v2.agreement)).status), "proposed");
  const createdInboxV2 = await createAssociatedTokenAccountIdempotent(
    connection, governance, mint, v2.vaultAuthority, confirm, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, true,
  );
  assert.ok(createdInboxV2.equals(inboxV2));
  await deposit(funderAta, funder, inboxV2, 250_000n);

  const v2Accounts = {
    config: v2.config,
    agreement: v2.agreement,
    vaultAuthority: v2.vaultAuthority,
    royaltyInbox: inboxV2,
  };
  async function nonSettleable(status, prefix) {
    await h.expectRejection(
      rejectCase(`${prefix}-01`, "D", `fund_and_allocate against a ${status} agreement`),
      () => fundTx(100_000n, 0n, v2Accounts, 0x89),
      [funder],
      { error: "SettlementUnavailable" },
    );
    await h.expectRejection(
      rejectCase(`${prefix}-02`, "D", `allocate_inbox against a ${status} agreement`),
      () => allocateTx(v2Accounts),
      [],
      { error: "SettlementUnavailable" },
    );
    await h.expectRejection(
      rejectCase(`${prefix}-03`, "D", `claim against a ${status} agreement`),
      () => claimTx(0, rotatedAta, v2Accounts),
      [],
      { error: "SettlementUnavailable" },
    );
    await h.expectRejection(
      rejectCase(`${prefix}-04`, "D", `initialize_royalty_inbox against a ${status} agreement`),
      () => initInboxTx(v2Accounts),
      [],
      { error: "SettlementUnavailable" },
    );
  }
  await nonSettleable("Proposed", "STATE-PROPOSED");
  await h.expectRejection(
    rejectCase("AUTH-04", "D", "non-participant approves a proposed agreement"),
    () => approveTx(v2, hashV2, attacker.publicKey, attacker.publicKey),
    [attacker],
    { error: "ParticipantNotFound" },
  );
  await h.expectRejection(
    rejectCase("AUTH-05", "D", "non-manager cancels a proposed agreement"),
    () =>
      methods
        .cancelAgreement()
        .accountsStrict({ revenuePool: v2.revenuePool, agreement: v2.agreement, manager: attacker.publicKey })
        .transaction(),
    [attacker],
    { error: "Unauthorized" },
  );
  await h.expectSuccess(
    "manager cancels v2",
    await methods
      .cancelAgreement()
      .accountsStrict({ revenuePool: v2.revenuePool, agreement: v2.agreement, manager: governance.publicKey })
      .transaction(),
    [governance],
  );
  assert.equal(enumName((await agreementState(v2.agreement)).status), "cancelled");
  await nonSettleable("Cancelled", "STATE-CANCELLED");

  // V1 remains Active and solvent after every rejection above.
  agreement = await agreementState(v1.agreement);
  assert.equal(enumName(agreement.status), "active");
  await assertInvariants("final");

  const rejections = h.evidence.length;
  console.log(
    JSON.stringify(
      {
        suite: "phase-3d.3-adversarial-local-validator",
        programId: programId.toBase58(),
        settlementMint: mint.toBase58(),
        rejections,
        cases: h.evidence,
        positiveAssertions: h.assertions,
        invariantCheckpoints: h.invariantCheckpoints,
        finalAgreementV1: {
          cumulativeGross: bigint(agreement.cumulativeGross).toString(),
          directFundingNonce: bigint(agreement.directFundingNonce).toString(),
          allocationSequence: bigint(agreement.allocationSequence).toString(),
        },
        status: "PASS",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
