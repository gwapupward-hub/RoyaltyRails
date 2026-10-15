import {
  MAX_RECIPIENTS,
  MIN_RECIPIENTS,
  TOTAL_SHARE_UNITS,
  U128_MAX,
  U64_MAX,
  type Agreement,
  type AllocationInput,
  type AllocationResult,
  type CumulativeState,
  type Participant,
  type SettlementBasis,
} from "./types.js";

const DENOMINATOR = BigInt(TOTAL_SHARE_UNITS);
const U32_MAX = 0xffff_ffff;
const SUPPORTED_SETTLEMENT_BASES: readonly SettlementBasis[] = [
  "OWNERSHIP_SPLIT",
  "REVENUE_PARTICIPATION",
  "PAYMENT_DIRECTION",
];

export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < 32; index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined || r === undefined) {
      throw new AccountingError("participant authority must be exactly 32 bytes");
    }
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

function validateAuthority(authority: Uint8Array): void {
  if (authority.length !== 32) {
    throw new AccountingError("participant authority must be exactly 32 bytes");
  }
  if (authority.every((byte) => byte === 0)) {
    throw new AccountingError("participant authority cannot be all-zero");
  }
}

export function canonicalizeParticipants(
  participants: readonly Participant[],
): Participant[] {
  return participants
    .map((participant) => ({
      authority: new Uint8Array(participant.authority),
      shareUnits: participant.shareUnits,
    }))
    .sort((left, right) => compareBytes(left.authority, right.authority));
}

export function validateAgreement(agreement: Agreement): void {
  const { participants } = agreement;

  if (!agreement.id.trim()) throw new AccountingError("agreement id is required");
  if (
    !Number.isSafeInteger(agreement.version) ||
    agreement.version < 1 ||
    agreement.version > U32_MAX
  ) {
    throw new AccountingError("agreement version must be a positive u32 integer");
  }
  if (!SUPPORTED_SETTLEMENT_BASES.includes(agreement.settlementBasis)) {
    throw new AccountingError("unsupported settlement basis");
  }
  if (participants.length < MIN_RECIPIENTS || participants.length > MAX_RECIPIENTS) {
    throw new AccountingError(
      `agreement must contain between ${MIN_RECIPIENTS} and ${MAX_RECIPIENTS} recipients`,
    );
  }

  let totalShareUnits = 0;
  let previousAuthority: Uint8Array | undefined;

  for (const participant of participants) {
    validateAuthority(participant.authority);

    if (
      previousAuthority !== undefined &&
      compareBytes(previousAuthority, participant.authority) >= 0
    ) {
      throw new AccountingError(
        "participant authorities must be strictly sorted by raw bytes and unique",
      );
    }
    previousAuthority = participant.authority;

    if (
      !Number.isSafeInteger(participant.shareUnits) ||
      participant.shareUnits <= 0 ||
      participant.shareUnits > TOTAL_SHARE_UNITS
    ) {
      throw new AccountingError("participant share must be a positive integer number of share units");
    }

    totalShareUnits += participant.shareUnits;
  }

  if (totalShareUnits !== TOTAL_SHARE_UNITS) {
    throw new AccountingError(
      `participant shares must total exactly ${TOTAL_SHARE_UNITS} share units`,
    );
  }
}

export function initialState(agreement: Agreement): CumulativeState {
  validateAgreement(agreement);

  return {
    gross: 0n,
    allocated: Array<bigint>(agreement.participants.length).fill(0n),
  };
}

function checkedU128(value: bigint, field: string): bigint {
  if (value < 0n || value > U128_MAX) {
    throw new AccountingError(`${field} must fit in u128`);
  }
  return value;
}

function checkedAddU128(left: bigint, right: bigint, field: string): bigint {
  return checkedU128(left + right, field);
}

/**
 * Computes floor(gross * share / D) and the positive fractional numerator
 * without multiplying the full u128 cumulative gross by the share.
 *
 * Let gross = qD + t, 0 <= t < D:
 *   floor(gross*share/D) = q*share + floor(t*share/D)
 *
 * q*share <= gross and t*share < D^2, so a Rust u128 implementation can
 * reproduce this over the full valid u128 cumulative state domain.
 */
export function proportionalEntitlementParts(
  gross: bigint,
  shareUnits: number,
): { floor: bigint; remainder: bigint } {
  checkedU128(gross, "gross");
  if (
    !Number.isSafeInteger(shareUnits) ||
    shareUnits <= 0 ||
    shareUnits > TOTAL_SHARE_UNITS
  ) {
    throw new AccountingError("share units are outside the v1 domain");
  }

  const share = BigInt(shareUnits);
  const quotient = gross / DENOMINATOR;
  const tail = gross % DENOMINATOR;
  const tailProduct = tail * share;

  const floor = checkedU128(
    quotient * share + tailProduct / DENOMINATOR,
    "proportional entitlement floor",
  );
  const remainder = tailProduct % DENOMINATOR;

  return { floor, remainder };
}

/**
 * Returns the signed proportional residual numerator in (-D, D).
 *
 * A valid bounded-error state can only be at floor(exact entitlement)
 * or exactly one base unit above it.
 */
export function roundingResidual(
  gross: bigint,
  allocated: bigint,
  shareUnits: number,
): bigint {
  checkedU128(allocated, "participant cumulative allocation");

  const { floor, remainder } = proportionalEntitlementParts(gross, shareUnits);

  if (allocated === floor) return remainder;
  if (floor < U128_MAX && allocated === floor + 1n) return remainder - DENOMINATOR;

  throw new AccountingError("participant rounding residual is outside the permitted bound");
}

export function validateState(agreement: Agreement, state: CumulativeState): void {
  validateAgreement(agreement);
  checkedU128(state.gross, "gross");

  if (state.allocated.length !== agreement.participants.length) {
    throw new AccountingError("state allocation length must match participant count");
  }

  let totalAllocated = 0n;
  let residualTotal = 0n;

  for (let index = 0; index < agreement.participants.length; index += 1) {
    const participant = agreement.participants[index];
    const allocated = state.allocated[index];

    if (participant === undefined || allocated === undefined) {
      throw new AccountingError("state is missing participant allocation data");
    }

    checkedU128(allocated, "participant cumulative allocation");

    const residual = roundingResidual(state.gross, allocated, participant.shareUnits);
    totalAllocated += allocated;
    residualTotal += residual;
  }

  if (totalAllocated !== state.gross) {
    throw new AccountingError("cumulative allocated amount must equal cumulative gross");
  }
  if (residualTotal !== 0n) {
    throw new AccountingError("rounding residuals must net to zero");
  }
}

/**
 * Deterministic bounded-error revenue allocation.
 *
 * The engine contains only economic math. It deliberately excludes funding
 * nonces, token accounts, payout routing, claims, and Solana execution.
 *
 * V1 arithmetic contract:
 * - current allocation input is positive u64;
 * - lifetime state is u128;
 * - cumulative proportional residual is computed with quotient/remainder
 *   decomposition, avoiding full-width u128 * share multiplication;
 * - tie breaks use already-validated canonical raw-authority order.
 */
export function allocate(
  agreement: Agreement,
  state: CumulativeState,
  input: AllocationInput,
): AllocationResult {
  validateState(agreement, state);

  if (input.amount <= 0n || input.amount > U64_MAX) {
    throw new AccountingError("allocation amount must be a positive u64");
  }

  const nextGross = checkedAddU128(state.gross, input.amount, "next cumulative gross");

  const scored = agreement.participants.map((participant, index) => {
    const priorAllocated = state.allocated[index];
    if (priorAllocated === undefined) {
      throw new AccountingError("internal participant accounting mismatch");
    }

    const residualBefore = roundingResidual(
      state.gross,
      priorAllocated,
      participant.shareUnits,
    );

    // Max magnitude is comfortably within signed i128:
    // u64::MAX * 100_000_000 < 2^91, plus a residual smaller than D.
    const accruedNumerator =
      residualBefore + input.amount * BigInt(participant.shareUnits);

    const baseAllocation =
      accruedNumerator <= 0n ? 0n : accruedNumerator / DENOMINATOR;
    const score = accruedNumerator - baseAllocation * DENOMINATOR;

    return {
      index,
      priorAllocated,
      baseAllocation,
      score,
    };
  });

  const baseTotal = scored.reduce((sum, entry) => sum + entry.baseAllocation, 0n);
  const remaining = input.amount - baseTotal;

  if (remaining < 0n || remaining > BigInt(scored.length)) {
    throw new AccountingError("rounding allocation exceeded recipient bounds");
  }

  const ranked = [...scored].sort((left, right) => {
    if (left.score > right.score) return -1;
    if (left.score < right.score) return 1;
    return left.index - right.index;
  });

  const extraRecipients = new Set<number>();
  const extraCount = Number(remaining);

  for (let index = 0; index < extraCount; index += 1) {
    const entry = ranked[index];
    if (entry === undefined || entry.score < 0n) {
      throw new AccountingError("invalid rounding allocation candidate");
    }
    extraRecipients.add(entry.index);
  }

  const allocations: bigint[] = [];
  const nextAllocated: bigint[] = [];
  let allocationTotal = 0n;

  for (const entry of scored) {
    const allocation =
      entry.baseAllocation + (extraRecipients.has(entry.index) ? 1n : 0n);
    allocations.push(allocation);
    nextAllocated.push(
      checkedAddU128(
        entry.priorAllocated,
        allocation,
        "next participant cumulative allocation",
      ),
    );
    allocationTotal += allocation;
  }

  if (allocationTotal !== input.amount) {
    throw new AccountingError("allocation conservation invariant failed");
  }

  const nextState: CumulativeState = {
    gross: nextGross,
    allocated: nextAllocated,
  };

  validateState(agreement, nextState);

  return { allocations, nextState };
}
