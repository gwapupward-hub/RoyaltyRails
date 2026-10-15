export const TOTAL_BPS = 10_000;
export const MIN_RECIPIENTS = 2;
export const MAX_RECIPIENTS = 16;

export type SettlementBasis =
  | "OWNERSHIP_SPLIT"
  | "REVENUE_PARTICIPATION"
  | "PAYMENT_DIRECTION";

export interface Participant {
  /** Stable identifier inside an agreement version. */
  id: string;
  /** Integer basis points. 10_000 = 100%. */
  shareBps: number;
}

export interface Agreement {
  id: string;
  version: number;
  settlementBasis: SettlementBasis;
  participants: readonly Participant[];
  /** Receives indivisible base-unit remainder after cumulative apportionment. */
  remainderRecipientId: string;
}

export interface CumulativeState {
  /** Total base units successfully settled under this agreement version. */
  gross: bigint;
  /** Lifetime amount paid to each participant. */
  paid: Readonly<Record<string, bigint>>;
  /** Expected nonce for the next direct settlement. */
  nextSettlementNonce: bigint;
}

export interface SettlementInput {
  /** Positive native token base-unit amount, e.g. USDC has 6 decimals. */
  amount: bigint;
  expectedNonce: bigint;
}

export interface SettlementResult {
  payouts: Readonly<Record<string, bigint>>;
  nextState: CumulativeState;
}
