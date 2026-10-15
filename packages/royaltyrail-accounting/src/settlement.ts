import {
  MAX_RECIPIENTS,
  MIN_RECIPIENTS,
  TOTAL_BPS,
  type Agreement,
  type CumulativeState,
  type SettlementInput,
  type SettlementResult,
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
    paid: Object.fromEntries(agreement.participants.map(({ id }) => [id, 0n])),
    nextSettlementNonce: 0n,
  };
}

function roundingResidual(gross: bigint, paid: bigint, shareBps: number): bigint {
  return gross * BigInt(shareBps) - paid * DENOMINATOR;
}

export function validateState(agreement: Agreement, state: CumulativeState): void {
  validateAgreement(agreement);

  if (state.gross < 0n) throw new AccountingError("gross cannot be negative");
  if (state.nextSettlementNonce < 0n) throw new AccountingError("nonce cannot be negative");

  let totalPaid = 0n;
  let residualTotal = 0n;
  const participantIds = new Set(agreement.participants.map(({ id }) => id));

  for (const participant of agreement.participants) {
    const paid = state.paid[participant.id];
    if (paid === undefined) throw new AccountingError("state is missing participant payout data");
    if (paid < 0n) throw new AccountingError("participant paid amount cannot be negative");

    const residual = roundingResidual(state.gross, paid, participant.shareBps);
    if (residual <= -DENOMINATOR || residual >= DENOMINATOR) {
      throw new AccountingError("participant rounding residual is outside the permitted bound");
    }

    totalPaid += paid;
    residualTotal += residual;
  }

  for (const stateId of Object.keys(state.paid)) {
    if (!participantIds.has(stateId)) {
      throw new AccountingError("state contains unknown participant payout data");
    }
  }

  if (totalPaid !== state.gross) {
    throw new AccountingError("cumulative paid amount must equal cumulative gross");
  }
  if (residualTotal !== 0n) {
    throw new AccountingError("rounding residuals must net to zero");
  }
}

/**
 * Deterministic bounded-error apportionment.
 *
 * Each participant carries an implicit signed rounding residual derived from
 * cumulative gross, BPS, and cumulative amount paid. A settlement first pays
 * every whole base unit currently due, then allocates the remaining indivisible
 * units to the highest residual scores. Canonical participant order breaks ties.
 *
 * Guarantees:
 * - payouts are never negative;
 * - payouts exactly conserve the settlement amount;
 * - each participant's lifetime rounding error stays below one base unit;
 * - no fixed recipient accumulates every rounding remainder.
 */
export function settle(
  agreement: Agreement,
  state: CumulativeState,
  input: SettlementInput,
): SettlementResult {
  validateState(agreement, state);

  if (input.amount <= 0n) throw new AccountingError("settlement amount must be positive");
  if (input.expectedNonce !== state.nextSettlementNonce) {
    throw new AccountingError("settlement nonce mismatch");
  }

  const scored = agreement.participants.map((participant, index) => {
    const priorPaid = state.paid[participant.id];
    if (priorPaid === undefined) {
      throw new AccountingError("internal participant accounting mismatch");
    }

    const residualBefore = roundingResidual(state.gross, priorPaid, participant.shareBps);
    const accruedNumerator = residualBefore + input.amount * BigInt(participant.shareBps);

    // BigInt division truncates toward zero. For non-positive accrued entitlement,
    // the participant receives zero rather than a negative/clawback payment.
    const basePayout = accruedNumerator <= 0n ? 0n : accruedNumerator / DENOMINATOR;
    const score = accruedNumerator - basePayout * DENOMINATOR;

    return {
      id: participant.id,
      index,
      priorPaid,
      basePayout,
      score,
    };
  });

  const baseTotal = scored.reduce((sum, entry) => sum + entry.basePayout, 0n);
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

  const payouts: Record<string, bigint> = {};
  const nextPaid: Record<string, bigint> = {};
  let payoutTotal = 0n;

  for (const entry of scored) {
    const payout = entry.basePayout + (extraRecipients.has(entry.id) ? 1n : 0n);
    payouts[entry.id] = payout;
    nextPaid[entry.id] = entry.priorPaid + payout;
    payoutTotal += payout;
  }

  if (payoutTotal !== input.amount) {
    throw new AccountingError("settlement conservation invariant failed");
  }

  const nextState: CumulativeState = {
    gross: state.gross + input.amount,
    paid: nextPaid,
    nextSettlementNonce: state.nextSettlementNonce + 1n,
  };

  validateState(agreement, nextState);

  return { payouts, nextState };
}
