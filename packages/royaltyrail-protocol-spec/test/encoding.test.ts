import { describe, expect, it } from "vitest";

import {
  RevenuePoolKind,
  SettlementBasis,
  SettlementMode,
  agreementHashV1,
  bytesToHex,
  payoutCommitmentV1,
  type AgreementHashInputV1,
  type PayoutCommitmentInputV1,
} from "../src/index.js";

function repeatedByte(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

const agreementVector: AgreementHashInputV1 = {
  programId: repeatedByte(0x01),
  revenuePool: repeatedByte(0x02),
  version: 1,
  settlementMint: repeatedByte(0x03),
  tokenProgram: repeatedByte(0x04),
  poolKind: RevenuePoolKind.MasterReceipts,
  settlementBasis: SettlementBasis.RevenueParticipation,
  poolMetadataHash: repeatedByte(0x05),
  termsHash: repeatedByte(0x06),
  participants: [
    {
      participantAuthority: repeatedByte(0x10),
      payoutWallet: repeatedByte(0x20),
      shareBps: 7_000,
      roleCode: 1,
    },
    {
      participantAuthority: repeatedByte(0x11),
      payoutWallet: repeatedByte(0x21),
      shareBps: 3_000,
      roleCode: 2,
    },
  ],
};

const payoutVector: PayoutCommitmentInputV1 = {
  agreement: repeatedByte(0x33),
  settlementSequence: 7n,
  mode: SettlementMode.Direct,
  grossAmount: 1_000_001n,
  payouts: [
    {
      participantAuthority: repeatedByte(0x10),
      payoutWallet: repeatedByte(0x20),
      payoutAmount: 700_001n,
    },
    {
      participantAuthority: repeatedByte(0x11),
      payoutWallet: repeatedByte(0x21),
      payoutAmount: 300_000n,
    },
  ],
};

describe("RoyaltyRail canonical protocol encoding", () => {
  it("matches the canonical agreement hash vector", () => {
    expect(bytesToHex(agreementHashV1(agreementVector))).toBe(
      "eae967b78c7ab02359e1563531eb3a31bceb5c54dd3903d67db5c15bfa910419",
    );
  });

  it("matches the canonical payout commitment vector", () => {
    expect(bytesToHex(payoutCommitmentV1(payoutVector))).toBe(
      "306358ddcb17322fe1ba98aeb6500b5087715b442a4a25a809bb6f722883fe19",
    );
  });

  it("rejects a non-canonical participant order", () => {
    expect(() =>
      agreementHashV1({
        ...agreementVector,
        participants: [...agreementVector.participants].reverse(),
      }),
    ).toThrow(/strictly sorted/);
  });

  it("rejects an agreement that does not total 10,000 BPS", () => {
    expect(() =>
      agreementHashV1({
        ...agreementVector,
        participants: [
          agreementVector.participants[0]!,
          { ...agreementVector.participants[1]!, shareBps: 2_999 },
        ],
      }),
    ).toThrow(/10_000|10000/);
  });

  it("rejects a payout commitment that does not conserve gross", () => {
    expect(() =>
      payoutCommitmentV1({
        ...payoutVector,
        payouts: [
          payoutVector.payouts[0]!,
          { ...payoutVector.payouts[1]!, payoutAmount: 299_999n },
        ],
      }),
    ).toThrow(/exactly equal gross/);
  });
});
