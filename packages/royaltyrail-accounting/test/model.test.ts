import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  TOTAL_SHARE_UNITS,
  U64_MAX,
  allocate,
  initialState,
  type Agreement,
  type CumulativeState,
} from "../src/index.js";

// Model-based settlement test mirroring docs/SECURITY_V1.md §3 (economic
// invariants) and §13 (arbitrary external_deposit / fund_and_allocate /
// allocate_inbox / claim_participant sequences, including dust).

const D = BigInt(TOTAL_SHARE_UNITS);

type Operation =
  | { kind: "externalDeposit"; amount: bigint }
  | { kind: "fundAndAllocate"; amount: bigint }
  | { kind: "allocateInbox" }
  | { kind: "claim"; participant: number };

interface Model {
  agreement: Agreement;
  state: CumulativeState;
  claimed: bigint[];
  /** SPL balance of the Royalty Inbox (u64 on-chain). */
  inbox: bigint;
}

function authority(value: number): Uint8Array {
  const out = new Uint8Array(32);
  out[31] = value;
  return out;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function at(values: readonly bigint[], index: number): bigint {
  const value = values[index];
  if (value === undefined) throw new Error(`no value at index ${index}`);
  return value;
}

/** 1–16 positive shares summing to exactly 100,000,000, from distinct cut points. */
const sharesArbitrary = fc
  .integer({ min: 1, max: 16 })
  .chain((count) =>
    fc.uniqueArray(fc.integer({ min: 1, max: TOTAL_SHARE_UNITS - 1 }), {
      minLength: count - 1,
      maxLength: count - 1,
    }),
  )
  .map((cuts) => {
    const points = [0, ...cuts.sort((left, right) => left - right), TOTAL_SHARE_UNITS];
    return points.slice(1).map((point, index) => point - (points[index] ?? 0));
  });

const amountArbitrary = fc.oneof(
  fc.bigInt({ min: 1n, max: 16n }), // dust and micro-deposits
  fc.bigInt({ min: 1n, max: 1_000_000_000n }),
  fc.bigInt({ min: 1n, max: 1n << 62n }),
);

function operationArbitrary(participants: number): fc.Arbitrary<Operation> {
  return fc.oneof(
    amountArbitrary.map((amount): Operation => ({ kind: "externalDeposit", amount })),
    amountArbitrary.map((amount): Operation => ({ kind: "fundAndAllocate", amount })),
    fc.constant<Operation>({ kind: "allocateInbox" }),
    fc.integer({ min: 0, max: participants - 1 }).map((participant): Operation => ({ kind: "claim", participant })),
  );
}

const scenarioArbitrary = sharesArbitrary.chain((shares) =>
  fc.record({
    shares: fc.constant(shares),
    operations: fc.array(operationArbitrary(shares.length), { minLength: 1, maxLength: 60 }),
  }),
);

function allocatedUnclaimed(model: Model): bigint {
  return model.state.gross - sum(model.claimed);
}

function runAllocation(model: Model, amount: bigint): void {
  const result = allocate(model.agreement, model.state, { amount });
  expect(sum(result.allocations)).toBe(amount);
  model.state = result.nextState;
}

/** Applies one operation as the program would; operations the program would reject are no-ops. */
function apply(model: Model, operation: Operation): void {
  switch (operation.kind) {
    case "externalDeposit":
      // Anyone can transfer to the inbox; an SPL balance cannot exceed u64.
      if (model.inbox + operation.amount <= U64_MAX) model.inbox += operation.amount;
      return;
    case "fundAndAllocate":
      if (model.inbox + operation.amount > U64_MAX) return;
      model.inbox += operation.amount;
      runAllocation(model, operation.amount);
      return;
    case "allocateInbox": {
      const unallocated = model.inbox - allocatedUnclaimed(model);
      if (unallocated > 0n) runAllocation(model, unallocated);
      return;
    }
    case "claim": {
      const index = operation.participant;
      const claimable = at(model.state.allocated, index) - at(model.claimed, index);
      if (claimable <= 0n) return;
      model.inbox -= claimable;
      model.claimed[index] = at(model.claimed, index) + claimable;
      return;
    }
  }
}

function assertInvariants(model: Model, cumulativeGross: bigint): void {
  const { state, claimed, agreement } = model;
  // sum(allocated) == cumulative gross (tracked independently of the engine).
  expect(state.gross).toBe(cumulativeGross);
  expect(sum(state.allocated)).toBe(cumulativeGross);
  // allocated_unclaimed <= inbox balance.
  expect(allocatedUnclaimed(model) <= model.inbox).toBe(true);
  expect(model.inbox >= 0n && model.inbox <= U64_MAX).toBe(true);

  agreement.participants.forEach((participant, index) => {
    const allocated = at(state.allocated, index);
    const claimedByParticipant = at(claimed, index);
    // 0 <= claimed <= allocated, per participant.
    expect(claimedByParticipant >= 0n && claimedByParticipant <= allocated).toBe(true);
    // |allocated − gross·share/D| < 1, i.e. |allocated·D − gross·share| < D, in exact integers.
    const deviation = allocated * D - cumulativeGross * BigInt(participant.shareUnits);
    expect(deviation > -D && deviation < D).toBe(true);
  });
}

describe("model-based settlement sequences", () => {
  it("preserves conservation, claim bounds, inbox solvency and proportional bounds after every step", () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ shares, operations }) => {
        expect(shares.reduce((total, share) => total + share, 0)).toBe(TOTAL_SHARE_UNITS);
        const agreement: Agreement = {
          id: "RR-MODEL",
          version: 1,
          settlementBasis: "REVENUE_PARTICIPATION",
          participants: shares.map((shareUnits, index) => ({ authority: authority(index + 1), shareUnits })),
        };
        const model: Model = {
          agreement,
          state: initialState(agreement),
          claimed: shares.map(() => 0n),
          inbox: 0n,
        };
        let cumulativeGross = 0n;

        for (const operation of operations) {
          const grossBefore = model.state.gross;
          apply(model, operation);
          cumulativeGross += model.state.gross - grossBefore;
          assertInvariants(model, cumulativeGross);
        }

        // Draining: after allocating everything and claiming every participant,
        // the inbox holds exactly zero and every unit was claimed.
        apply(model, { kind: "allocateInbox" });
        cumulativeGross = model.state.gross;
        shares.forEach((_, participant) => apply(model, { kind: "claim", participant }));
        assertInvariants(model, cumulativeGross);
        expect(model.inbox).toBe(0n);
        expect(sum(model.claimed)).toBe(cumulativeGross);
      }),
      { numRuns: 300 },
    );
  });
});
