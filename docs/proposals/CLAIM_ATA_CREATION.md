# Proposal: claiming to a payout wallet with no token account

Status: **Draft proposal — design only. No program change is made or authorized by this document.**

RoyaltyRails is devnet-only and unaudited.

## 1. Problem

`claim_participant` (`programs/royaltyrail/src/settlement_ix.rs`, `ClaimParticipant`) takes the destination as

```rust
#[account(mut)]
pub payout_destination: Account<'info, TokenAccount>,
```

and then `validate_payout_destination` requires that it is exactly `ATA(payout_wallet, settlement_mint, token_program)`, with matching mint and owner. Anchor deserializes `Account<TokenAccount>` before the handler runs. So if the participant's canonical ATA does not exist yet, **a bare `claim_participant` fails**. That happens for a new wallet, after a payout-wallet rotation, or after the participant closed the ATA.

What this does and does not affect:

- Other participants are unaffected; claims are independent (SECURITY_V1 §24, INTEGRATION_UX_V1 §7).
- The participant's allocation is unaffected. It stays claimable, and nothing is lost.
- The real cost is **liveness and UX**. A keeper or SDK that sends a bare claim gets a failed transaction, and the participant appears "unpaid".

INTEGRATION_UX_V1 §7 already allows composing `createAssociatedTokenAccountIdempotent` + `claim_participant` in one transaction. ATA creation is permissionless, so any payer can create an ATA for any wallet. This proposal compares making that path robust against moving it on-chain.

## 2. Options

### Option 1 — Keeper pre-creates the ATA

Before claiming, a keeper sends a separate transaction that runs `createAssociatedTokenAccountIdempotent(payer = keeper, owner = payout_wallet, mint, token_program)`.

- **Program change.** None.
- **Who pays rent.** The keeper. That is the rent-exempt minimum for a 165-byte SPL token account, about 0.002 SOL, and it is reclaimable only by the ATA owner closing it.
- **Failure modes.**
  - Two transactions, so there is a window between them. A payout-wallet rotation in that window means the next claim targets a different, possibly missing, ATA.
  - Keeper downtime delays claims.
  - Keeper-funded rent is a cost that can be griefed: a participant can close and force re-creation repeatedly. The keeper should rate-limit.
- **Security.** No new on-chain surface. The ATA program derives the address; a wrong owner or mint yields a different address, which `validate_payout_destination` still rejects.

### Option 2 — Idempotent ATA creation inside `claim_participant` (caller pays)

`ClaimParticipant` gains `payer: Signer` (mut), the payout wallet as an unchecked account, `system_program`, and `associated_token_program`. `payout_destination` becomes an `UncheckedAccount`. The handler CPIs `associated_token::create_idempotent` (already used by `initialize_royalty_inbox`), then deserializes and runs `validate_payout_destination` manually before `transfer_checked`.

- **Program change.** Yes. It changes the account list, the IDL, the SBF, and the frozen manifest, and every client must change, so it is **breaking for existing integrations**. It must not change the claim invariants, events, or error codes. The existing `InvalidPayoutDestination*` checks must still run after the CPI.
- **Deployment.** An in-place upgrade by the upgrade authority, or a new deployment. Either way: re-audit, regenerate the manifest, and repeat the compute benchmarks (DEPLOYMENT_DEVNET_V1 unresolved risk 3).
- **Who pays rent.** The claim caller: a keeper, the participant, or anyone.
- **Failure modes.**
  - Higher compute and more accounts per claim.
  - Moving from `Account<TokenAccount>` to an `UncheckedAccount` with manual checks widens the account-substitution surface (SECURITY_V1 §24). A mistake here is a fund-misrouting bug, which is the most severe class.
  - A frozen existing ATA still fails at transfer; no change there.
- **Security.** New CPI path in the most value-sensitive instruction. Needs adversarial tests: wrong owner, wrong mint, a pre-existing non-ATA account at the address (impossible for a PDA-derived ATA but must be tested), Token-2022 program substitution, and payer ≠ caller.

### Option 3 — SDK-side guard

The canonical SDK's `claim(participant)` reads the destination ATA. If the ATA is missing, the SDK prepends `createAssociatedTokenAccountIdempotent(payer = fee payer, owner = current payout_wallet, mint, token_program)` to the **same transaction** as `claim_participant`. The ATA address is derived from the payout wallet read in the same RPC snapshot. If the account exists, the SDK sends the bare claim.

The SDK also exposes `claimabilityReport()` with the values `missing ATA`, `frozen ATA`, and `zero claimable`, so keepers can skip and report instead of failing blindly.

- **Program change.** None. This is the INTEGRATION_UX_V1 §7 composition, made the default.
- **Who pays rent.** The transaction fee payer.
- **Failure modes.**
  - If the payout wallet rotates between the RPC read and execution, `claim_participant` rejects the now-wrong ATA (`InvalidPayoutDestinationAddress`). The transaction fails atomically, the stray ATA is never created (whole transaction reverts), and the SDK retries with fresh state.
  - Third-party integrators who bypass the SDK still hit the bare-claim failure.
- **Security.** No new on-chain surface. The idempotent create is a no-op if the ATA exists, and the program's existing destination checks remain the authority.

## 3. Comparison

| | 1. Keeper pre-create | 2. In-program create | 3. SDK guard |
| --- | --- | --- | --- |
| Program / IDL change | No | Yes (breaking) | No |
| New deployment or upgrade | No | Yes | No |
| Atomic with the claim | No (2 txs) | Yes | Yes (1 tx) |
| New on-chain attack surface | None | CPI + unchecked destination | None |
| Works for non-SDK callers | If they run a keeper | Yes | No |
| Extra compute in the claim tx | 0 (separate tx) | ATA CPI | ATA program instruction (only when missing) |

## 4. Recommendation

**Option 3 as the default, with Option 1 as the keeper fallback. No program change for v1.**

The existing program already makes the composed transaction safe: the destination is fully validated on-chain. So the problem can be solved entirely off-chain without touching the audited claim path.

Revisit Option 2 only for a future program version, and only if:

1. measurement (§5) shows comfortable headroom under the default 200,000 CU at 16 participants, and
2. the owner accepts a breaking IDL change plus a re-audit of the claim path.

## 5. Method for estimating compute-unit impact

**Baseline** (DEPLOYMENT_DEVNET_V1, "Measured 16-participant behaviour", commit `24bb488`, Agave 4.1.2 local validator):

| Instruction | CU (run 1 / run 2) | Default limit |
| --- | --- | --- |
| `claim_participant` | 43,863 / 39,382 | 200,000 |
| `initialize_royalty_inbox` (includes one `create_idempotent` CPI) | 44,291 / 48,791 | 200,000 |

The spread between runs comes from `find_program_address` bump search, which depends on the keys.

**Procedure.** Local validator only, using the pinned container and toolchain. Never against devnet or mainnet keys.

1. **Control key variance.** Generate K = 20 fixed sets of throwaway keys and record them as test fixtures, so every variant runs against identical PDAs and ATAs. Report min, median, and max per variant, not single runs.
2. **Measure per instruction.** Take `computeUnitsConsumed` from the transaction meta, plus the per-instruction `Program … consumed X of Y compute units` log lines, for each scenario:
   - **A.** Bare `claim_participant`, ATA exists. This reproduces the baseline.
   - **B.** `createAssociatedTokenAccountIdempotent` + `claim_participant`, ATA **missing** (Option 3, creation path).
   - **C.** The same as B, ATA **exists** (Option 3, idempotent no-op path).
   - **D.** Option 2 only: a throwaway prototype branch, never merged, with in-program `create_idempotent`, run for both missing and existing ATA. This needs its own build; it is not the frozen artifact.
3. **Derive the deltas.**
   - Option 3 overhead = B − A (or C − A).
   - Option 2 overhead = D − A.
   - Cross-check: `initialize_royalty_inbox` − its non-CPI work approximates one `create_idempotent` CPI.
4. **Check limits and size.**
   - Confirm that the worst case (max of B and D across K) plus a 20% margin for future code growth stays under 200,000 CU. Otherwise clients must set an explicit compute budget, as risk 3 already advises.
   - Record transaction size for B and D against 1,232 bytes. Option 2 adds up to 4 accounts (128 bytes) if they are not already present.
5. **Record the results.** Add them to the deployment record alongside the existing table, with commit, toolchain, and K.

## 6. Out of scope

- Supporting Token-2022 or non-canonical payout destinations. v1 deliberately requires the canonical ATA of the participant-controlled payout wallet.
- Any change to who may claim, or to allocation, invariants, events, or error codes.
