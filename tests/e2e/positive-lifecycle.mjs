import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import anchor from "@anchor-lang/core";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
} from "@solana/spl-token";

// @anchor-lang/core ships CommonJS to Node; BN is not detectable as a named
// ESM export, so destructure from the default export instead.
const { AnchorProvider, BN, EventParser, Program, setProvider } = anchor;

const USDC_DECIMALS = 6;
const SHARE_UNITS = 100_000_000;
const CONFIG_SEED = Buffer.from("config");
const WORK_SEED = Buffer.from("work");
const POOL_SEED = Buffer.from("pool");
const AGREEMENT_SEED = Buffer.from("agreement");
const VAULT_SEED = Buffer.from("vault");

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

function loadKeypair(path) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

async function airdrop(connection, publicKey, sol = 3) {
  const signature = await connection.requestAirdrop(
    publicKey,
    sol * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(signature, "confirmed");
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

function royaltyInboxAddress(mint, vaultAuthority) {
  return getAssociatedTokenAddressSync(
    mint,
    vaultAuthority,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function payoutAta(mint, wallet) {
  return getAssociatedTokenAddressSync(
    mint,
    wallet,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function assertConservation(agreement) {
  const gross = bigint(agreement.cumulativeGross);
  const totalAllocated = agreement.participants.reduce(
    (sum, participant) => sum + bigint(participant.cumulativeAllocated),
    0n,
  );
  assert.equal(totalAllocated, gross, "allocated lifetime total must equal gross");

  for (const participant of agreement.participants) {
    assert.ok(
      bigint(participant.cumulativeClaimed) <= bigint(participant.cumulativeAllocated),
      "claimed must never exceed allocated",
    );
  }
}

async function requireEvent(connection, program, signature, expectedName) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  assert.ok(tx?.meta?.logMessages, `missing logs for ${signature}`);

  const parser = new EventParser(program.programId, program.coder);
  const events = [...parser.parseLogs(tx.meta.logMessages)];
  const target = expectedName.replaceAll("_", "").toLowerCase();
  const event = events.find(
    (candidate) =>
      candidate.name.replaceAll("_", "").toLowerCase() === target,
  );
  assert.ok(
    event,
    `expected ${expectedName}; saw ${events.map((item) => item.name).join(", ")}`,
  );
  return event;
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

  const participants = [Keypair.generate(), Keypair.generate()].sort((a, b) =>
    Buffer.compare(a.publicKey.toBuffer(), b.publicKey.toBuffer()),
  );
  const funder = Keypair.generate();
  const guardian = Keypair.generate();
  const rotatedWallet = Keypair.generate();

  await Promise.all([
    airdrop(connection, governance.publicKey, 10),
    airdrop(connection, participants[0].publicKey),
    airdrop(connection, participants[1].publicKey),
    airdrop(connection, funder.publicKey),
  ]);

  const mint = await createMint(
    connection,
    governance,
    governance.publicKey,
    null,
    USDC_DECIMALS,
    undefined,
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const funderToken = await getOrCreateAssociatedTokenAccount(
    connection,
    governance,
    mint,
    funder.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  await mintTo(
    connection,
    governance,
    mint,
    funderToken.address,
    governance,
    5_000_000n,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const initialPayoutAccounts = [];
  for (const participant of participants) {
    initialPayoutAccounts.push(
      await getOrCreateAssociatedTokenAccount(
        connection,
        governance,
        mint,
        participant.publicKey,
        false,
        "confirmed",
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }

  const workId = fixedBytes(0x21);
  const poolId = fixedBytes(0x31);
  const workMetadataHash = fixedBytes(0x41);
  const poolMetadataHash = fixedBytes(0x51);
  const termsHashV1 = fixedBytes(0x61);
  const deploymentId = fixedBytes(0x71);
  const pdasV1 = derivePdas(
    programId,
    governance.publicKey,
    workId,
    poolId,
    1,
  );
  const royaltyInboxV1 = royaltyInboxAddress(mint, pdasV1.vaultAuthority);

  let signature = await program.methods
    .initializeConfig(deploymentId, guardian.publicKey)
    .accounts({
      config: pdasV1.config,
      governanceAuthority: governance.publicKey,
      settlementMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "ProtocolInitialized");

  signature = await program.methods
    .registerWork(workId, governance.publicKey, workMetadataHash)
    .accounts({
      work: pdasV1.work,
      originAuthority: governance.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "WorkRegistered");

  signature = await program.methods
    .registerRevenuePool(
      poolId,
      { masterReceipts: {} },
      { revenueParticipation: {} },
      poolMetadataHash,
    )
    .accounts({
      work: pdasV1.work,
      revenuePool: pdasV1.revenuePool,
      manager: governance.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "RevenuePoolRegistered");

  const participantInputs = [
    {
      participantAuthority: participants[0].publicKey,
      shareUnits: 60_000_000,
    },
    {
      participantAuthority: participants[1].publicKey,
      shareUnits: 40_000_000,
    },
  ];
  assert.equal(
    participantInputs.reduce((sum, item) => sum + item.shareUnits, 0),
    SHARE_UNITS,
  );

  signature = await program.methods
    .proposeAgreement(1, termsHashV1, participantInputs)
    .accounts({
      config: pdasV1.config,
      revenuePool: pdasV1.revenuePool,
      agreement: pdasV1.agreement,
      manager: governance.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "AgreementProposed");

  let agreementV1 = await program.account.agreementVersionState.fetch(
    pdasV1.agreement,
  );
  const agreementHashV1 = Array.from(agreementV1.agreementHash);

  for (const participant of participants) {
    signature = await program.methods
      .approveAgreement(agreementHashV1, participant.publicKey)
      .accounts({
        config: pdasV1.config,
        revenuePool: pdasV1.revenuePool,
        agreement: pdasV1.agreement,
        participant: participant.publicKey,
      })
      .signers([participant])
      .rpc();
    await requireEvent(connection, program, signature, "ParticipantApproved");
  }

  signature = await program.methods
    .activateInitialAgreement()
    .accounts({
      config: pdasV1.config,
      revenuePool: pdasV1.revenuePool,
      agreement: pdasV1.agreement,
    })
    .rpc();
  await requireEvent(connection, program, signature, "AgreementActivated");

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.equal(enumName(agreementV1.status), "active");
  assertConservation(agreementV1);

  signature = await program.methods
    .initializeRoyaltyInbox()
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payer: governance.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "RoyaltyInboxInitialized");

  const directAmountOne = 1_000_000n;
  signature = await program.methods
    .fundAndAllocate(
      new BN(directAmountOne.toString()),
      new BN(0),
      fixedBytes(0x81),
    )
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payerSource: funderToken.address,
      payer: funder.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([funder])
    .rpc();
  let allocationEvent = await requireEvent(
    connection,
    program,
    signature,
    "RevenueAllocated",
  );
  assert.ok(
    Array.from(allocationEvent.data.allocationCommitment).some((byte) => byte !== 0),
    "allocation commitment must be nonzero",
  );

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.equal(bigint(agreementV1.cumulativeGross), directAmountOne);
  assert.equal(bigint(agreementV1.directFundingNonce), 1n);
  assert.equal(bigint(agreementV1.allocationSequence), 1n);
  assertConservation(agreementV1);
  assert.equal((await getAccount(connection, royaltyInboxV1)).amount, directAmountOne);

  const rawDepositOne = 500_000n;
  await transferChecked(
    connection,
    funder,
    funderToken.address,
    mint,
    royaltyInboxV1,
    funder,
    rawDepositOne,
    USDC_DECIMALS,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const beforeInboxAllocation = await program.account.agreementVersionState.fetch(
    pdasV1.agreement,
  );
  assert.equal(bigint(beforeInboxAllocation.cumulativeGross), 1_000_000n);

  signature = await program.methods
    .allocateInbox()
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  allocationEvent = await requireEvent(
    connection,
    program,
    signature,
    "RevenueAllocated",
  );
  assert.ok(
    Array.from(allocationEvent.data.allocationCommitment).some((byte) => byte !== 0),
  );

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.equal(bigint(agreementV1.cumulativeGross), 1_500_000n);
  assert.equal(bigint(agreementV1.directFundingNonce), 1n);
  assert.equal(bigint(agreementV1.allocationSequence), 2n);
  assert.equal(bigint(agreementV1.participants[0].cumulativeAllocated), 900_000n);
  assert.equal(bigint(agreementV1.participants[1].cumulativeAllocated), 600_000n);
  assertConservation(agreementV1);

  for (let participantIndex = 0; participantIndex < participants.length; participantIndex += 1) {
    signature = await program.methods
      .claimParticipant(participantIndex)
      .accounts({
        config: pdasV1.config,
        agreement: pdasV1.agreement,
        settlementMint: mint,
        vaultAuthority: pdasV1.vaultAuthority,
        royaltyInbox: royaltyInboxV1,
        payoutDestination: initialPayoutAccounts[participantIndex].address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await requireEvent(connection, program, signature, "PayoutClaimed");
  }

  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[0].address)).amount,
    900_000n,
  );
  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[1].address)).amount,
    600_000n,
  );
  assert.equal((await getAccount(connection, royaltyInboxV1)).amount, 0n);

  const rotatedPayout = await getOrCreateAssociatedTokenAccount(
    connection,
    governance,
    mint,
    rotatedWallet.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  signature = await program.methods
    .updatePayoutWallet(rotatedWallet.publicKey)
    .accounts({
      agreement: pdasV1.agreement,
      participant: participants[0].publicKey,
    })
    .signers([participants[0]])
    .rpc();
  await requireEvent(connection, program, signature, "PayoutWalletUpdated");

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.ok(agreementV1.participants[0].payoutWallet.equals(rotatedWallet.publicKey));
  assert.equal(agreementV1.participants[0].payoutRevision, 2);

  signature = await program.methods
    .fundAndAllocate(new BN(1_000_000), new BN(1), fixedBytes(0x82))
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payerSource: funderToken.address,
      payer: funder.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([funder])
    .rpc();
  await requireEvent(connection, program, signature, "RevenueAllocated");

  await program.methods
    .claimParticipant(0)
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payoutDestination: rotatedPayout.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await program.methods
    .claimParticipant(1)
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payoutDestination: initialPayoutAccounts[1].address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[0].address)).amount,
    900_000n,
    "old payout route must not receive post-rotation claims",
  );
  assert.equal((await getAccount(connection, rotatedPayout.address)).amount, 600_000n);
  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[1].address)).amount,
    1_000_000n,
  );

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.equal(bigint(agreementV1.cumulativeGross), 2_500_000n);
  assert.equal(bigint(agreementV1.directFundingNonce), 2n);
  assert.equal(bigint(agreementV1.allocationSequence), 3n);
  assertConservation(agreementV1);

  // Replacement agreement: same authorities and economics, but participant 0's
  // current payout route is carried forward explicitly through a new approval.
  const pdasV2 = derivePdas(
    programId,
    governance.publicKey,
    workId,
    poolId,
    2,
  );
  const termsHashV2 = fixedBytes(0x62);

  signature = await program.methods
    .proposeAgreement(2, termsHashV2, participantInputs)
    .accounts({
      config: pdasV2.config,
      revenuePool: pdasV2.revenuePool,
      agreement: pdasV2.agreement,
      manager: governance.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await requireEvent(connection, program, signature, "AgreementProposed");

  let agreementV2 = await program.account.agreementVersionState.fetch(pdasV2.agreement);
  const agreementHashV2 = Array.from(agreementV2.agreementHash);
  const successorPayoutWallets = [rotatedWallet.publicKey, participants[1].publicKey];

  for (let index = 0; index < participants.length; index += 1) {
    signature = await program.methods
      .approveAgreement(agreementHashV2, successorPayoutWallets[index])
      .accounts({
        config: pdasV2.config,
        revenuePool: pdasV2.revenuePool,
        agreement: pdasV2.agreement,
        participant: participants[index].publicKey,
      })
      .signers([participants[index]])
      .rpc();
    await requireEvent(connection, program, signature, "ParticipantApproved");
  }

  for (const participant of participants) {
    signature = await program.methods
      .approveSupersession(agreementHashV2)
      .accounts({
        config: pdasV2.config,
        revenuePool: pdasV2.revenuePool,
        successor: pdasV2.agreement,
        predecessor: pdasV1.agreement,
        participant: participant.publicKey,
      })
      .signers([participant])
      .rpc();
    await requireEvent(connection, program, signature, "SupersessionApproved");
  }

  signature = await program.methods
    .activateReplacementAgreement()
    .accounts({
      config: pdasV2.config,
      revenuePool: pdasV2.revenuePool,
      successor: pdasV2.agreement,
      predecessor: pdasV1.agreement,
    })
    .rpc();
  await requireEvent(connection, program, signature, "AgreementSuperseded");
  await requireEvent(connection, program, signature, "AgreementActivated");

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  agreementV2 = await program.account.agreementVersionState.fetch(pdasV2.agreement);
  assert.equal(enumName(agreementV1.status), "superseded");
  assert.equal(enumName(agreementV2.status), "active");

  // Historical revenue arriving after supersession must still settle against
  // the predecessor's immutable economics and current payout routing state.
  const historicalDeposit = 250_000n;
  await transferChecked(
    connection,
    funder,
    funderToken.address,
    mint,
    royaltyInboxV1,
    funder,
    historicalDeposit,
    USDC_DECIMALS,
    [],
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  signature = await program.methods
    .allocateInbox()
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await requireEvent(connection, program, signature, "RevenueAllocated");

  await program.methods
    .claimParticipant(0)
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payoutDestination: rotatedPayout.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  await program.methods
    .claimParticipant(1)
    .accounts({
      config: pdasV1.config,
      agreement: pdasV1.agreement,
      settlementMint: mint,
      vaultAuthority: pdasV1.vaultAuthority,
      royaltyInbox: royaltyInboxV1,
      payoutDestination: initialPayoutAccounts[1].address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  agreementV1 = await program.account.agreementVersionState.fetch(pdasV1.agreement);
  assert.equal(bigint(agreementV1.cumulativeGross), 2_750_000n);
  assert.equal(bigint(agreementV1.directFundingNonce), 2n);
  assert.equal(bigint(agreementV1.allocationSequence), 4n);
  assert.equal(bigint(agreementV1.participants[0].cumulativeAllocated), 1_650_000n);
  assert.equal(bigint(agreementV1.participants[1].cumulativeAllocated), 1_100_000n);
  assert.equal(bigint(agreementV1.participants[0].cumulativeClaimed), 1_650_000n);
  assert.equal(bigint(agreementV1.participants[1].cumulativeClaimed), 1_100_000n);
  assertConservation(agreementV1);

  assert.equal((await getAccount(connection, royaltyInboxV1)).amount, 0n);
  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[0].address)).amount,
    900_000n,
  );
  assert.equal((await getAccount(connection, rotatedPayout.address)).amount, 750_000n);
  assert.equal(
    (await getAccount(connection, initialPayoutAccounts[1].address)).amount,
    1_100_000n,
  );

  const pool = await program.account.revenuePoolState.fetch(pdasV1.revenuePool);
  assert.equal(pool.activeVersion, 2);
  assert.equal(pool.pendingVersion, 0);

  console.log(
    JSON.stringify(
      {
        programId: programId.toBase58(),
        settlementMint: mint.toBase58(),
        revenuePool: pdasV1.revenuePool.toBase58(),
        predecessorAgreement: pdasV1.agreement.toBase58(),
        successorAgreement: pdasV2.agreement.toBase58(),
        predecessorGross: bigint(agreementV1.cumulativeGross).toString(),
        predecessorAllocationSequence: bigint(
          agreementV1.allocationSequence,
        ).toString(),
        predecessorDirectFundingNonce: bigint(
          agreementV1.directFundingNonce,
        ).toString(),
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
