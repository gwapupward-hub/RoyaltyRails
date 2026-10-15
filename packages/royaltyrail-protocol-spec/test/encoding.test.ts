import { describe, expect, it } from "vitest";

import {
  AllocationMode,
  RevenuePoolKind,
  SettlementBasis,
  agreementHashV1,
  allocationCommitmentV1,
  bytesToHex,
  type AgreementHashInputV1,
  type AllocationCommitmentInputV1,
} from "../src/index.js";

function repeatedByte(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

const agreementVector: AgreementHashInputV1 = {
  deploymentId: repeatedByte(0x0a),
  programId: repeatedByte(0x01),
  revenuePool: repeatedByte(0x02),
  version: 1,
  predecessorVersion: 0,
  settlementMint: repeatedByte(0x03),
  tokenProgram: repeatedByte(0x04),
  poolKind: RevenuePoolKind.MasterReceipts,
  settlementBasis: SettlementBasis.RevenueParticipation,
  poolMetadataHash: repeatedByte(0x05),
  termsHash: repeatedByte(0x06),
  participants: [
    { participantAuthority: repeatedByte(0x10), shareUnits: 70_000_000 },
    { participantAuthority: repeatedByte(0x11), shareUnits: 30_000_000 },
  ],
};

const allocationVector: AllocationCommitmentInputV1 = {
  deploymentId: repeatedByte(0x0a),
  agreement: repeatedByte(0x33),
  allocationSequence: 7n,
  mode: AllocationMode.DirectFunding,
  grossAmount: 1_000_001n,
  paymentReference: repeatedByte(0x44),
  allocations: [
    { participantAuthority: repeatedByte(0x10), allocationAmount: 700_001n },
    { participantAuthority: repeatedByte(0x11), allocationAmount: 300_000n },
  ],
};

describe("RoyaltyRail canonical protocol encoding", () => {
  it("matches the canonical six-decimal agreement hash vector", () => {
    expect(bytesToHex(agreementHashV1(agreementVector))).toBe(
      "7c3864a1ad4ed61713d694523cd2737bc69ad81bd1428c72f5bd3dcba76b2032",
    );
  });

  it("matches the canonical allocation commitment vector", () => {
    expect(bytesToHex(allocationCommitmentV1(allocationVector))).toBe(
      "bbbb4c0ef0d9617c5427d85cf9828d5767689a59bd696324adde3e03d9316950",
    );
  });

  it("accepts a single 100% economic participant", () => {
    expect(() =>
      agreementHashV1({
        ...agreementVector,
        participants: [{ participantAuthority: repeatedByte(0x10), shareUnits: 100_000_000 }],
      }),
    ).not.toThrow();
  });

  it("accepts the maximum u32 agreement version", () => {
    expect(() =>
      agreementHashV1({ ...agreementVector, version: 0xffff_ffff, predecessorVersion: 0xffff_fffe }),
    ).not.toThrow();
  });

  it("rejects a non-canonical participant order", () => {
    expect(() =>
      agreementHashV1({ ...agreementVector, participants: [...agreementVector.participants].reverse() }),
    ).toThrow(/strictly sorted/);
  });

  it("rejects an agreement that does not total 100,000,000 share units", () => {
    expect(() =>
      agreementHashV1({
        ...agreementVector,
        participants: [
          agreementVector.participants[0]!,
          { ...agreementVector.participants[1]!, shareUnits: 29_999_999 },
        ],
      }),
    ).toThrow(/100000000/);
  });

  it("rejects agreement versions outside the u32 domain", () => {
    expect(() => agreementHashV1({ ...agreementVector, version: 0 })).toThrow(/positive u32/);
    expect(() => agreementHashV1({ ...agreementVector, version: 0x1_0000_0000 })).toThrow(/positive u32/);
  });

  it("rejects unsafe Number values before BigInt conversion", () => {
    expect(() =>
      agreementHashV1({ ...agreementVector, version: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow(/positive u32|safe integer/);

    expect(() =>
      agreementHashV1({
        ...agreementVector,
        participants: [
          { participantAuthority: repeatedByte(0x10), shareUnits: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
    ).toThrow(/safe integer|share domain/);
  });

  it("rejects an invalid predecessor version", () => {
    expect(() =>
      agreementHashV1({ ...agreementVector, version: 2, predecessorVersion: 2 }),
    ).toThrow(/predecessor version/);
  });

  it("rejects an all-zero deployment id", () => {
    expect(() => agreementHashV1({ ...agreementVector, deploymentId: new Uint8Array(32) })).toThrow(
      /deployment id cannot be all-zero/,
    );
  });

  it("rejects unsupported runtime enums", () => {
    expect(() => agreementHashV1({ ...agreementVector, poolKind: 99 as RevenuePoolKind })).toThrow(
      /supported v1 enum/,
    );
    expect(() =>
      agreementHashV1({ ...agreementVector, settlementBasis: 99 as SettlementBasis }),
    ).toThrow(/supported v1 enum/);
    expect(() =>
      allocationCommitmentV1({ ...allocationVector, mode: 99 as AllocationMode }),
    ).toThrow(/supported v1 enum/);
  });

  it("rejects allocation sequence zero", () => {
    expect(() => allocationCommitmentV1({ ...allocationVector, allocationSequence: 0n })).toThrow(
      /sequence must be positive/,
    );
  });

  it("rejects allocation amounts outside u64", () => {
    expect(() =>
      allocationCommitmentV1({
        ...allocationVector,
        grossAmount: 1n << 64n,
        allocations: [
          { participantAuthority: repeatedByte(0x10), allocationAmount: 1n << 64n },
        ],
      }),
    ).toThrow(/8 bytes/);
  });

  it("rejects an allocation commitment that does not conserve gross", () => {
    expect(() =>
      allocationCommitmentV1({
        ...allocationVector,
        allocations: [
          allocationVector.allocations[0]!,
          { ...allocationVector.allocations[1]!, allocationAmount: 299_999n },
        ],
      }),
    ).toThrow(/exactly equal gross/);
  });
});
