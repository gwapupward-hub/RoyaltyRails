import { createHash } from "node:crypto";

export const AGREEMENT_DOMAIN_V1 = "ROYALTYRAIL_AGREEMENT_V1";
export const ALLOCATION_DOMAIN_V1 = "ROYALTYRAIL_ALLOCATION_V1";
export const MAX_PARTICIPANTS = 16;
export const MIN_PARTICIPANTS = 1;
export const TOTAL_BPS = 10_000;

export enum RevenuePoolKind {
  MasterReceipts = 0,
  CompositionReceipts = 1,
  Custom = 2,
}

export enum SettlementBasis {
  OwnershipSplit = 0,
  RevenueParticipation = 1,
  PaymentDirection = 2,
}

export enum AllocationMode {
  DirectFunding = 0,
  Inbox = 1,
}

export interface AgreementHashParticipantV1 {
  participantAuthority: Uint8Array;
  shareBps: number;
  roleCode: number;
}

export interface AgreementHashInputV1 {
  deploymentId: Uint8Array;
  programId: Uint8Array;
  revenuePool: Uint8Array;
  version: number;
  predecessorVersion: number;
  settlementMint: Uint8Array;
  tokenProgram: Uint8Array;
  poolKind: RevenuePoolKind;
  settlementBasis: SettlementBasis;
  poolMetadataHash: Uint8Array;
  termsHash: Uint8Array;
  participants: readonly AgreementHashParticipantV1[];
}

export interface AllocationCommitmentParticipantV1 {
  participantAuthority: Uint8Array;
  allocationAmount: bigint;
}

export interface AllocationCommitmentInputV1 {
  deploymentId: Uint8Array;
  agreement: Uint8Array;
  allocationSequence: bigint;
  mode: AllocationMode;
  grossAmount: bigint;
  /** External reconciliation value. All-zero means no reference. */
  paymentReference: Uint8Array;
  allocations: readonly AllocationCommitmentParticipantV1[];
}

function bytes32(value: Uint8Array, field: string): Uint8Array {
  if (value.length !== 32) throw new Error(`${field} must be exactly 32 bytes`);
  return value;
}

function nonZeroBytes32(value: Uint8Array, field: string): Uint8Array {
  bytes32(value, field);
  if (value.every((byte) => byte === 0)) throw new Error(`${field} cannot be all-zero`);
  return value;
}

function encodeUnsignedLe(value: bigint, byteLength: number, field: string): Uint8Array {
  if (value < 0n) throw new Error(`${field} cannot be negative`);

  const limit = 1n << BigInt(byteLength * 8);
  if (value >= limit) throw new Error(`${field} does not fit in ${byteLength} bytes`);

  const out = new Uint8Array(byteLength);
  let remaining = value;

  for (let index = 0; index < byteLength; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return out;
}

function u8(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${field} must be an unsigned 8-bit integer`);
  }
  return new Uint8Array([value]);
}

function u16(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return encodeUnsignedLe(BigInt(value), 2, field);
}

function u32(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return encodeUnsignedLe(BigInt(value), 4, field);
}

function u64(value: bigint, field: string): Uint8Array {
  return encodeUnsignedLe(value, 8, field);
}

function assertEnumValue(value: number, allowed: readonly number[], field: string): void {
  if (!Number.isInteger(value) || !allowed.includes(value)) {
    throw new Error(`${field} is not a supported v1 enum value`);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined || r === undefined) throw new Error("unexpected byte comparison state");
    if (l < r) return -1;
    if (l > r) return 1;
  }

  return left.length - right.length;
}

function validateCanonicalAuthorities<T extends { participantAuthority: Uint8Array }>(
  participants: readonly T[],
): void {
  if (participants.length < MIN_PARTICIPANTS || participants.length > MAX_PARTICIPANTS) {
    throw new Error(`participant count must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}`);
  }

  let previous: Uint8Array | undefined;

  for (const participant of participants) {
    const authority = nonZeroBytes32(participant.participantAuthority, "participant authority");
    if (previous !== undefined && compareBytes(previous, authority) >= 0) {
      throw new Error("participant authorities must be strictly sorted and unique");
    }
    previous = authority;
  }
}

function sha256(preimage: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(preimage).digest());
}

export function agreementPreimageV1(input: AgreementHashInputV1): Uint8Array {
  validateCanonicalAuthorities(input.participants);

  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new Error("agreement version must be a positive integer");
  }
  if (
    !Number.isInteger(input.predecessorVersion) ||
    input.predecessorVersion < 0 ||
    input.predecessorVersion >= input.version
  ) {
    throw new Error("predecessor version must be zero or lower than agreement version");
  }

  assertEnumValue(
    input.poolKind,
    [RevenuePoolKind.MasterReceipts, RevenuePoolKind.CompositionReceipts, RevenuePoolKind.Custom],
    "pool kind",
  );
  assertEnumValue(
    input.settlementBasis,
    [
      SettlementBasis.OwnershipSplit,
      SettlementBasis.RevenueParticipation,
      SettlementBasis.PaymentDirection,
    ],
    "settlement basis",
  );

  let totalBps = 0;
  const participantParts: Uint8Array[] = [];

  for (const participant of input.participants) {
    if (!Number.isInteger(participant.shareBps) || participant.shareBps <= 0) {
      throw new Error("share BPS must be a positive integer");
    }

    totalBps += participant.shareBps;
    participantParts.push(
      nonZeroBytes32(participant.participantAuthority, "participant authority"),
      u16(participant.shareBps, "share BPS"),
      u16(participant.roleCode, "role code"),
    );
  }

  if (totalBps !== TOTAL_BPS) {
    throw new Error(`participant shares must total exactly ${TOTAL_BPS} BPS`);
  }

  return concat([
    new TextEncoder().encode(AGREEMENT_DOMAIN_V1),
    nonZeroBytes32(input.deploymentId, "deployment id"),
    nonZeroBytes32(input.programId, "program id"),
    nonZeroBytes32(input.revenuePool, "revenue pool"),
    u32(input.version, "version"),
    u32(input.predecessorVersion, "predecessor version"),
    nonZeroBytes32(input.settlementMint, "settlement mint"),
    nonZeroBytes32(input.tokenProgram, "token program"),
    u8(input.poolKind, "pool kind"),
    u8(input.settlementBasis, "settlement basis"),
    bytes32(input.poolMetadataHash, "pool metadata hash"),
    bytes32(input.termsHash, "terms hash"),
    u8(input.participants.length, "participant count"),
    ...participantParts,
  ]);
}

export function agreementHashV1(input: AgreementHashInputV1): Uint8Array {
  return sha256(agreementPreimageV1(input));
}

export function allocationPreimageV1(input: AllocationCommitmentInputV1): Uint8Array {
  validateCanonicalAuthorities(input.allocations);

  assertEnumValue(input.mode, [AllocationMode.DirectFunding, AllocationMode.Inbox], "allocation mode");

  if (input.allocationSequence <= 0n) {
    throw new Error("allocation sequence must be positive");
  }
  if (input.grossAmount <= 0n) throw new Error("gross amount must be positive");

  let allocationTotal = 0n;
  const allocationParts: Uint8Array[] = [];

  for (const allocation of input.allocations) {
    if (allocation.allocationAmount < 0n) throw new Error("allocation amount cannot be negative");
    allocationTotal += allocation.allocationAmount;
    allocationParts.push(
      nonZeroBytes32(allocation.participantAuthority, "participant authority"),
      u64(allocation.allocationAmount, "allocation amount"),
    );
  }

  if (allocationTotal !== input.grossAmount) {
    throw new Error("allocation amounts must exactly equal gross amount");
  }

  return concat([
    new TextEncoder().encode(ALLOCATION_DOMAIN_V1),
    nonZeroBytes32(input.deploymentId, "deployment id"),
    nonZeroBytes32(input.agreement, "agreement"),
    u64(input.allocationSequence, "allocation sequence"),
    u8(input.mode, "allocation mode"),
    u64(input.grossAmount, "gross amount"),
    bytes32(input.paymentReference, "payment reference"),
    u8(input.allocations.length, "participant count"),
    ...allocationParts,
  ]);
}

export function allocationCommitmentV1(input: AllocationCommitmentInputV1): Uint8Array {
  return sha256(allocationPreimageV1(input));
}

export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}
