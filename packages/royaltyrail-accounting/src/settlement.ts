import {
  MAX_RECIPIENTS,
  MIN_RECIPIENTS,
  TOTAL_BPS,
  type Agreement,
  type CumulativeState,
  type SettlementInput,
  type SettlementResult,
} from "./types.js";

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

  if (!ids.has(agreement.remainderRecipientId)) {
    throw new AccountingError("remainder recipient must be an agreement participant");
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

export function validateState(agreement: Agreement, state: CumulativeState): void {
  validateAgreement(agreement);

  if (state.gross < 0n) throw new AccountingError("gross cannot be negative");
  if (state.nextSettlementNonce < 0n) throw new AccountingError("nonce cannot be negative");

  let totalPaid = 0n;
  const participantIds = new Set(agreement.participants.map(({ id }) => id));

  for (const participant of agreement.participants) {
    const paid = state.paid[participant.id];
    if (paid === undefined) throw new AccountingError("state is missing participant payout data");
    if (paid < 0n) throw new AccountingError("participant paid amount cannot be negative");
    totalPaid += paid;
  }

  for (const stateId of Object.keys(state.paid)) {
    if (!participantIds.has(stateId)) {
      throw new AccountingError("state contains unknown participant payout data");
    }
  }

  if (totalPaid !== state.gross) {
    throw new AccountingError("cumulative paid amount must equal cumulative gross");
  }
}

/**
 * Deterministic cumulative apportionment.
 *
 * Rather than rounding every payment independently, RoyaltyRail computes each
 * participant's lifetime target from cumulative gross and pays only the delta.
 * Any indivisible remainder goes to the explicitly approved remainder recipient.
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

  const newGross = state.gross + input.amount;
  const baseTargets: Record<string, bigint> = {};
  let baseTargetTotal = 0n;

  for (const participant of agreement.participants) {
    const target = (newGross * BigInt(participant.shareBps)) / BigInt(TOTAL_BPS);
    baseTargets[participant.id] = target;
    baseTargetTotal += target;
  }

  const remainder = newGross - baseTargetTotal;
  const targets: Record<string, bigint> = { ...baseTargets };
  targets[agreement.remainderRecipientId] =
    (targets[agreement.remainderRecipientId] ?? 0n) + remainder;

  const payouts: Record<string, bigint> = {};
  const nextPaid: Record<string, bigint> = {};
  let payoutTotal = 0n;

  for (const participant of agreement.participants) {
    const priorPaid = state.paid[participant.id];
    const target = targets[participant.id];

    if (priorPaid === undefined || target === undefined) {
      throw new AccountingError("internal participant accounting mismatch");
    }

    const payout = target - priorPaid;
    if (payout < 0n) {
      throw new AccountingError("settlement would reduce a participant's cumulative payout");
    }

    payouts[participant.id] = payout;
    nextPaid[participant.id] = target;
    payoutTotal += payout;
  }

  if (payoutTotal !== input.amount) {
    throw new AccountingError("settlement conservation invariant failed");
  }

  return {
    payouts,
    nextState: {
      gross: newGross,
      paid: nextPaid,
      nextSettlementNonce: state.nextSettlementNonce + 1n,
    },
  };
}
