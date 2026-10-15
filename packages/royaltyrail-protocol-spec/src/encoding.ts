import { createHash } from "node:crypto";

export const AGREEMENT_DOMAIN_V1 = "ROYALTYRAIL_AGREEMENT_V1";
export const PAYOUT_DOMAIN_V1 = "ROYALTYRAIL_PAYOUT_V1";
export const MAX_PARTICIPANTS = 16;
export const MIN_PARTICIPANTS = 2;
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

export enum SettlementMode {
  Direct = 0,
  Inbox = 1,
}

export interface AgreementHashParticipantV1 {
  participantAuthority: Uint8Array;
  payoutWallet: Uint8Array;
  shareBps: number;
  roleCode: number;
}

export interface AgreementHashInputV1 {
  programId: Uint8Array;
  revenuePool: Uint8Array;
  version: number;
  settlementMint: Uint8Array;
  tokenProgram: Uint8Array;
  poolKind: RevenuePoolKind;
  settlementBasis: SettlementBasis;
  poolMetadataHash: Uint8Array;
  termsHash: Uint8Array;
  participants: readonly AgreementHashParticipantV1[];
}

export interface PayoutCommitmentParticipantV1 {
  participantAuthority: Uint8Array;
  payoutWallet: Uint8Array;
  payoutAmount: bigint;
}

export interface PayoutCommitmentInputV1 {
  agreement: Uint8Array;
  settlementSequence: bigint;
  mode: SettlementMode;
  grossAmount: bigint;
  payouts: readonly PayoutCommitmentParticipantV1[];
}

function bytes32(value: Uint8Array, field: string): Uint8Array {
  if (value.length !== 32) throw new Error(`${field} must be exactly 32 bytes`);
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
    const authority = bytes32(participant.participantAuthority, "participant authority");
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

  let totalBps = 0;
  const participantParts: Uint8Array[] = [];

  for (const participant of input.participants) {
    if (!Number.isInteger(participant.shareBps) || participant.shareBps <= 0) {
      throw new Error("share BPS must be a positive integer");
    }

    totalBps += participant.shareBps;
    participantParts.push(
      bytes32(participant.participantAuthority, "participant authority"),
      bytes32(participant.payoutWallet, "payout wallet"),
      u16(participant.shareBps, "share BPS"),
      u16(participant.roleCode, "role code"),
    );
  }

  if (totalBps !== TOTAL_BPS) {
    throw new Error(`participant shares must total exactly ${TOTAL_BPS} BPS`);
  }

  return concat([
    new TextEncoder().encode(AGREEMENT_DOMAIN_V1),
    bytes32(input.programId, "program id"),
    bytes32(input.revenuePool, "revenue pool"),
    u32(input.version, "version"),
    bytes32(input.settlementMint, "settlement mint"),
    bytes32(input.tokenProgram, "token program"),
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

export function payoutPreimageV1(input: PayoutCommitmentInputV1): Uint8Array {
  validateCanonicalAuthorities(input.payouts);

  if (input.grossAmount <= 0n) throw new Error("gross amount must be positive");

  let payoutTotal = 0n;
  const payoutParts: Uint8Array[] = [];

  for (const payout of input.payouts) {
    if (payout.payoutAmount < 0n) throw new Error("payout amount cannot be negative");
    payoutTotal += payout.payoutAmount;
    payoutParts.push(
      bytes32(payout.participantAuthority, "participant authority"),
      bytes32(payout.payoutWallet, "payout wallet"),
      u64(payout.payoutAmount, "payout amount"),
    );
  }

  if (payoutTotal !== input.grossAmount) {
    throw new Error("payout amounts must exactly equal gross amount");
  }

  return concat([
    new TextEncoder().encode(PAYOUT_DOMAIN_V1),
    bytes32(input.agreement, "agreement"),
    u64(input.settlementSequence, "settlement sequence"),
    u8(input.mode, "settlement mode"),
    u64(input.grossAmount, "gross amount"),
    u8(input.payouts.length, "participant count"),
    ...payoutParts,
  ]);
}

export function payoutCommitmentV1(input: PayoutCommitmentInputV1): Uint8Array {
  return sha256(payoutPreimageV1(input));
}

export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}
