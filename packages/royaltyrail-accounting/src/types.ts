export const TOTAL_BPS = 10_000;
export const MIN_RECIPIENTS = 1;
export const MAX_RECIPIENTS = 16;

export type SettlementBasis =
  | "OWNERSHIP_SPLIT"
  | "REVENUE_PARTICIPATION"
  | "PAYMENT_DIRECTION";

export interface Participant {
  /** Stable economic participant identifier inside an agreement version. */
  id: string;
  /** Integer basis points. 10_000 = 100%. */
  shareBps: number;
}

export interface Agreement {
  id: string;
  version: number;
  settlementBasis: SettlementBasis;
  /**
   * Order is canonical and therefore part of the agreement semantics.
   * It is used only as a deterministic tie-break when allocation scores are equal.
   */
  participants: readonly Participant[];
}

export interface CumulativeState {
  /** Total settlement-asset base units economically allocated under this agreement version. */
  gross: bigint;
  /** Lifetime economic allocation to each participant. Token claims are tracked separately on-chain. */
  allocated: Readonly<Record<string, bigint>>;
}

export interface AllocationInput {
  /** Positive settlement-asset base-unit amount, e.g. native USDC has 6 decimals. */
  amount: bigint;
}

export interface AllocationResult {
  allocations: Readonly<Record<string, bigint>>;
  nextState: CumulativeState;
}
