export const TOTAL_SHARE_UNITS = 100_000_000;
export const MIN_RECIPIENTS = 1;
export const MAX_RECIPIENTS = 16;
export const U64_MAX = (1n << 64n) - 1n;
export const U128_MAX = (1n << 128n) - 1n;

export type SettlementBasis =
  | "OWNERSHIP_SPLIT"
  | "REVENUE_PARTICIPATION"
  | "PAYMENT_DIRECTION";

export interface Participant {
  /** Raw 32-byte economic authority. Canonical order is raw-byte ascending. */
  authority: Uint8Array;
  /**
   * Fixed-point percentage units. 100_000_000 = 100% and 1 unit = 0.000001%.
   */
  shareUnits: number;
}

export interface Agreement {
  id: string;
  /** Mirrors the on-chain u32 agreement version domain. */
  version: number;
  settlementBasis: SettlementBasis;
  /**
   * Participants MUST already be in canonical raw-authority byte order.
   * The accounting engine validates this because order is the deterministic
   * tie-break for indivisible settlement-asset base units.
   */
  participants: readonly Participant[];
}

export interface CumulativeState {
  /** Total settlement-asset base units economically allocated under this agreement version. */
  gross: bigint;
  /**
   * Lifetime economic allocation by canonical participant index.
   * Token claims are tracked separately on-chain.
   */
  allocated: readonly bigint[];
}

export interface AllocationInput {
  /**
   * Positive settlement-asset base-unit amount.
   * V1 allocation inputs are bounded to u64 because they originate from SPL token amounts.
   */
  amount: bigint;
}

export interface AllocationResult {
  /** Newly allocated settlement-asset base units by canonical participant index. */
  allocations: readonly bigint[];
  nextState: CumulativeState;
}
