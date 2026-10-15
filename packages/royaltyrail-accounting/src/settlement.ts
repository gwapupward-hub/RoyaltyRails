import {
  MAX_RECIPIENTS,
  MIN_RECIPIENTS,
  TOTAL_BPS,
  type Agreement,
  type AllocationInput,
  type AllocationResult,
  type CumulativeState,
} from "./types.js";

const DENOMINATOR = BigInt(TOTAL_BPS);

export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}

export function validateAgreement(agreement: Agreement): void {
  const { participants } = agreement;

  if (!agreement.id.trim()) throw new AccountingError("agreement id is required");
  if (!Number.isInteger(agreement.version) || agreement.version < 1) {
    throw new AccountingError("agreement version must be a positive integer");
  }
  if (participants.length < MIN_RECIPIENTS || participants.length > MAX_RECIPIENTS) {
    throw new AccountingError(
      `agreement must contain between ${MIN_RECIPIENTS} and ${MAX_RECIPIENTS} recipients`,
    );
  }

  const ids = new Set<string>();
  let totalBps = 0;

  for (const participant of participants) {
    if (!participant.id.trim()) throw new AccountingError("participant id is required");
    if (ids.has(participant.id)) throw new AccountingError("duplicate participant id");
    ids.add(participant.id);

    if (!Number.isInteger(participant.shareBps) || participant.shareBps <= 0) {
      throw new AccountingError("participant share must be a positive integer number of BPS");
    }

    totalBps += participant.shareBps;
  }

  if (totalBps !== TOTAL_BPS) {
    throw new AccountingError(`participant shares must total exactly ${TOTAL_BPS} BPS`);
  }
}

export function initialState(agreement: Agreement): CumulativeState {
  validateAgreement(agreement);

  return {
    gross: 0n,
    allocated: Object.fromEntries(agreement.participants.map(({ id }) => [id, 0n])),
    nextDirectNonce: 0n,
  };
}

function roundingResidual(gross: bigint, allocated: bigint, shareBps: number): bigint {
  return gross * BigInt(shareBps) - allocated * DENOMINATOR;
}

export function validateState(agreement: Agreement, state: CumulativeState): void {
  validateAgreement(agreement);

  if (state.gross < 0n) throw new AccountingError("gross cannot be negative");
  if (state.nextDirectNonce < 0n) throw new AccountingError("nonce cannot be negative");

  let totalAllocated = 0n;
  let residualTotal = 0n;
  const participantIds = new Set(agreement.participants.map(({ id }) => id));

  for (const participant of agreement.participants) {
    const allocated = state.allocated[participant.id];
    if (allocated === undefined) {
      throw new AccountingError("state is missing participant allocation data");
    }
    if (allocated < 0n) throw new AccountingError("participant allocation cannot be negative");

    const residual = roundingResidual(state.gross, allocated, participant.shareBps);
    if (residual <= -DENOMINATOR || residual >= DENOMINATOR) {
      throw new AccountingError("participant rounding residual is outside the permitted bound");
    }

    totalAllocated += allocated;
    residualTotal += residual;
  }

  for (const stateId of Object.keys(state.allocated)) {
    if (!participantIds.has(stateId)) {
      throw new AccountingError("state contains unknown participant allocation data");
    }
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
 * Each participant carries an implicit signed rounding residual derived from
 * cumulative gross, BPS, and cumulative allocation. New revenue is allocated
 * without performing token delivery. Claim state is intentionally outside this
 * economic reference engine so payout routing cannot alter percentage math.
 *
 * Guarantees:
 * - allocations are never negative;
 * - allocations exactly conserve the input amount;
 * - each participant's lifetime proportional error stays below one base unit;
 * - no fixed participant accumulates every rounding remainder.
 */
export function allocate(
  agreement: Agreement,
  state: CumulativeState,
  input: AllocationInput,
): AllocationResult {
  validateState(agreement, state);

  if (input.amount <= 0n) throw new AccountingError("allocation amount must be positive");
  if (input.expectedNonce !== state.nextDirectNonce) {
    throw new AccountingError("direct allocation nonce mismatch");
  }

  const scored = agreement.participants.map((participant, index) => {
    const priorAllocated = state.allocated[participant.id];
    if (priorAllocated === undefined) {
      throw new AccountingError("internal participant accounting mismatch");
    }

    const residualBefore = roundingResidual(
      state.gross,
      priorAllocated,
      participant.shareBps,
    );
    const accruedNumerator = residualBefore + input.amount * BigInt(participant.shareBps);

    // BigInt division truncates toward zero. For non-positive accrued entitlement,
    // the participant receives zero rather than a negative/clawback allocation.
    const baseAllocation = accruedNumerator <= 0n ? 0n : accruedNumerator / DENOMINATOR;
    const score = accruedNumerator - baseAllocation * DENOMINATOR;

    return {
      id: participant.id,
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

  const ranked = [...scored].sort((a, b) => {
    if (a.score > b.score) return -1;
    if (a.score < b.score) return 1;
    return a.index - b.index;
  });

  const extraRecipients = new Set<string>();
  const extraCount = Number(remaining);

  for (let i = 0; i < extraCount; i += 1) {
    const entry = ranked[i];
    if (entry === undefined || entry.score < 0n) {
      throw new AccountingError("invalid rounding allocation candidate");
    }
    extraRecipients.add(entry.id);
  }

  const allocations: Record<string, bigint> = {};
  const nextAllocated: Record<string, bigint> = {};
  let allocationTotal = 0n;

  for (const entry of scored) {
    const allocation = entry.baseAllocation + (extraRecipients.has(entry.id) ? 1n : 0n);
    allocations[entry.id] = allocation;
    nextAllocated[entry.id] = entry.priorAllocated + allocation;
    allocationTotal += allocation;
  }

  if (allocationTotal !== input.amount) {
    throw new AccountingError("allocation conservation invariant failed");
  }

  const nextState: CumulativeState = {
    gross: state.gross + input.amount,
    allocated: nextAllocated,
    nextDirectNonce: state.nextDirectNonce + 1n,
  };

  validateState(agreement, nextState);

  return { allocations, nextState };
}
