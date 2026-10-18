# Phase 3D.3 — Adversarial Local-Validator Evidence

Status: **complete for the local-validator scope described below.** This is test evidence against a local `solana-test-validator`; it is not a third-party security audit, formal verification, devnet/mainnet deployment evidence, or mainnet approval.

## What was tested

`tests/e2e/adversarial-matrix.mjs` (Anchor.toml script `test-adversarial`) deploys the actual compiled `royaltyrail.so` to a fresh local validator, builds a real settlement fixture (six-decimal legacy SPL mint, ProtocolConfig, Work, RevenuePool, a 60/40 two-participant agreement, canonical Royalty Inbox, real SPL funding and claims), and then submits **68 invalid transactions**.

Stage 3D.3 changed no program code, and its original 63-case matrix found no defect: every attack was rejected by the intended control. Stage 3D.4 later identified that `initialize_config` was first-caller-wins, bound it to the program's upgrade authority, and added five front-running cases (`CFG-04` to `CFG-08`). They land before the authorized initialization and are all rejected.

### How each rejection is proven

Every expected-to-fail transaction except `REPLAY-01` (see below) is sent with `skipPreflight: true`, so it is not merely refused by RPC simulation: it lands on the validator, executes, fails, and pays a fee. For each case the harness:

1. snapshots every tracked account (owner, lamports, executable flag, and full data bytes);
2. submits exactly one instruction built with `accountsStrict` (no client-side account resolution can silently replace an injected account);
3. fetches the landed transaction and asserts `InstructionError` at instruction 0 with the exact expected error number;
4. asserts the failing program logged that error (`Error Code: <name>. Error Number: <n>.` from RoyaltyRail, attributed to the substituted account where Anchor reports one, or the SPL Token program's own failure line);
5. asserts the fee payer's lamport change equals the reported fee exactly (fees are not protocol mutation; a dedicated fee payer keeps balances inside exact JavaScript integer range);
6. re-snapshots and requires every tracked account to be byte-for-byte, owner-for-owner, and lamport-for-lamport identical.

An unexpected success aborts the suite with `SECURITY FAILURE`. Unknown error names, duplicate signatures, and multi-instruction adversarial transactions are rejected as harness errors rather than counted as security evidence.

Tracked accounts (25 before the substitution fixtures exist, 28 after): the program account, its ProgramData, the ProgramData of an attacker-deployed upgradeable program, ProtocolConfig, Work, RevenuePool, predecessor and successor AgreementVersion PDAs, both vault PDAs, both canonical Royalty Inboxes, every participant/funder/victim/attacker token account, the decoy inbox, the vault's other-mint ATA, the vault-owned Token-2022 account, and all four mints (settlement, other legacy, nine-decimal, Token-2022).

After every successful step (14 checkpoints) the harness also asserts: `sum(cumulative_allocated) == cumulative_gross`; per-participant `cumulative_claimed <= cumulative_allocated`; Royalty Inbox balance `>=` allocated-but-unclaimed liabilities, with the surplus equal to the exact raw deposits not yet allocated; and exact conservation — the settlement mint's supply equals the sum of every settlement-mint token account the test created.

## Rejection matrix

Generated from the JSON report printed by CI run [39084154985](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39084154985) (job [Local validator adversarial matrix](https://github.com/gwapupward-hub/RoyaltyRails/actions/runs/39084154985/job/117547106152)) on commit `24bb48872849294dba4c15c8e1554b8b90124899`. Categories follow the Stage 3D.3 brief: A substitution, B replay, C payout, D authorization/state, E accounting/solvency.

| ID | Cat. | Attempted attack | Expected rejection | Observed on-chain | Rollback |
|---|---|---|---|---|---|
| CFG-04 | D | attacker front-runs initialize_config signing as governance and upgrade authority | `UnauthorizedConfigInitializer` | UnauthorizedConfigInitializer (6076) on program_data | 25 accounts byte-identical |
| CFG-05 | D | attacker substitutes the ProgramData of an upgradeable program it controls | `InvalidProgramData` | InvalidProgramData (6075) on program | 25 accounts byte-identical |
| CFG-06 | D | attacker substitutes its own program account and ProgramData | `InvalidProgramId` | InvalidProgramId (3008) on program | 25 accounts byte-identical |
| CFG-07 | D | attacker passes a non-loader account as ProgramData | `AccountOwnedByWrongProgram` | AccountOwnedByWrongProgram (3007) on program_data | 25 accounts byte-identical |
| CFG-08 | D | attacker names the real upgrade authority without its signature | `AccountNotSigner` | AccountNotSigner (3010) on upgrade_authority | 25 accounts byte-identical |
| CFG-01 | A | ProtocolConfig bound to Token-2022 program and mint | `InvalidTokenProgram` | InvalidTokenProgram (6003) | 25 accounts byte-identical |
| CFG-02 | A | ProtocolConfig bound to a Token-2022 mint under the legacy program id | `InvalidSettlementMintOwner` | InvalidSettlementMintOwner (6005) | 25 accounts byte-identical |
| CFG-03 | A | ProtocolConfig bound to a non-six-decimal settlement mint | `InvalidSettlementMintDecimals` | InvalidSettlementMintDecimals (6007) | 25 accounts byte-identical |
| INIT-01 | A | initialize inbox with a non-settlement mint | `SettlementConfigMismatch` | SettlementConfigMismatch (6050) on settlement_mint | 25 accounts byte-identical |
| INIT-02 | A | initialize inbox through Token-2022 | `InvalidProgramId` | InvalidProgramId (3008) on token_program | 25 accounts byte-identical |
| INIT-03 | A | initialize inbox with a non-canonical vault PDA | `ConstraintSeeds` | ConstraintSeeds (2006) on vault_authority | 25 accounts byte-identical |
| INIT-04 | A | initialize a non-canonical Royalty Inbox address | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 25 accounts byte-identical |
| REPLAY-01 | B | byte-identical replay of a landed fund_and_allocate transaction | `runtime AlreadyProcessed` | rejected by validator: transaction already processed | 28 accounts byte-identical |
| REPLAY-02 | B | reuse consumed direct-funding nonce 0 | `DirectFundingNonceMismatch` | DirectFundingNonceMismatch (6053) | 28 accounts byte-identical |
| REPLAY-03 | B | skip ahead to a future direct-funding nonce | `DirectFundingNonceMismatch` | DirectFundingNonceMismatch (6053) | 28 accounts byte-identical |
| REPLAY-04 | B | allocate an inbox whose balance is already fully allocated | `NoUnallocatedInboxFunds` | NoUnallocatedInboxFunds (6056) | 28 accounts byte-identical |
| REPLAY-05 | B | double-allocate the same raw deposit | `NoUnallocatedInboxFunds` | NoUnallocatedInboxFunds (6056) | 28 accounts byte-identical |
| SUB-01 | A | fund_and_allocate with a non-settlement mint | `SettlementConfigMismatch` | SettlementConfigMismatch (6050) on settlement_mint | 28 accounts byte-identical |
| SUB-02 | A | claim with a non-settlement mint | `SettlementConfigMismatch` | SettlementConfigMismatch (6050) on settlement_mint | 28 accounts byte-identical |
| SUB-03 | A | fund_and_allocate through Token-2022 | `InvalidProgramId` | InvalidProgramId (3008) on token_program | 28 accounts byte-identical |
| SUB-04 | A | allocate_inbox through Token-2022 | `InvalidProgramId` | InvalidProgramId (3008) on token_program | 28 accounts byte-identical |
| SUB-05 | A | claim through Token-2022 | `InvalidProgramId` | InvalidProgramId (3008) on token_program | 28 accounts byte-identical |
| SUB-06 | A | fund into a vault-owned Token-2022 account | `AccountOwnedByWrongProgram` | AccountOwnedByWrongProgram (3007) on royalty_inbox | 28 accounts byte-identical |
| SUB-07 | A | claim from a vault-owned Token-2022 account | `AccountOwnedByWrongProgram` | AccountOwnedByWrongProgram (3007) on royalty_inbox | 28 accounts byte-identical |
| SUB-08 | A | fund_and_allocate with an attacker key as vault PDA | `ConstraintSeeds` | ConstraintSeeds (2006) on vault_authority | 28 accounts byte-identical |
| SUB-09 | A | claim signed by another agreement's vault PDA | `ConstraintSeeds` | ConstraintSeeds (2006) on vault_authority | 28 accounts byte-identical |
| SUB-10 | A | allocate_inbox with a wrong-seed vault PDA | `ConstraintSeeds` | ConstraintSeeds (2006) on vault_authority | 28 accounts byte-identical |
| SUB-11 | A/E | fund into a vault-owned, settlement-mint, non-canonical decoy inbox | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 28 accounts byte-identical |
| SUB-12 | A/E | allocate a funded decoy inbox (would inflate gross without canonical funds) | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 28 accounts byte-identical |
| SUB-13 | A | claim out of a funded decoy inbox | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 28 accounts byte-identical |
| SUB-14 | A | Royalty Inbox with the wrong mint (vault ATA of another mint) | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 28 accounts byte-identical |
| SUB-15 | A | Royalty Inbox with the wrong token authority (attacker-owned account) | `InvalidRoyaltyInboxAddress` | InvalidRoyaltyInboxAddress (6066) | 28 accounts byte-identical |
| SUB-16 | A | fund_and_allocate from a payer source of another mint | `InvalidPayerSourceMint` | InvalidPayerSourceMint (6054) | 28 accounts byte-identical |
| SUB-17 | A/D | fund_and_allocate from a victim's account signed by another payer | `InvalidPayerSourceAuthority` | InvalidPayerSourceAuthority (6055) | 28 accounts byte-identical |
| SUB-18 | A/D | fund_and_allocate using an SPL delegate approval on a victim account | `InvalidPayerSourceAuthority` | InvalidPayerSourceAuthority (6055) | 28 accounts byte-identical |
| SUB-19 | A/D | fund_and_allocate naming the source owner as payer without its signature | `AccountNotSigner` | AccountNotSigner (3010) on payer | 28 accounts byte-identical |
| SUB-20 | D | claim with a substituted ProtocolConfig account | `AccountDiscriminatorMismatch` | AccountDiscriminatorMismatch (3002) on config | 28 accounts byte-identical |
| REPLAY-06 | B/D | re-claim an amount already claimed | `NoClaimableAmount` | NoClaimableAmount (6060) | 28 accounts byte-identical |
| PAY-01 | C | route p1's claim into p0's canonical ATA | `InvalidPayoutDestinationAddress` | InvalidPayoutDestinationAddress (6062) | 28 accounts byte-identical |
| PAY-02 | C | route p1's claim into an attacker ATA | `InvalidPayoutDestinationAddress` | InvalidPayoutDestinationAddress (6062) | 28 accounts byte-identical |
| PAY-03 | C | route p1's claim into p1's ATA of another mint | `InvalidPayoutDestinationAddress` | InvalidPayoutDestinationAddress (6062) | 28 accounts byte-identical |
| PAY-04 | C | route p1's claim into a non-ATA account p1 owns | `InvalidPayoutDestinationAddress` | InvalidPayoutDestinationAddress (6062) | 28 accounts byte-identical |
| PAY-05 | C | claim for participant index outside the set (2) | `InvalidParticipantIndex` | InvalidParticipantIndex (6073) | 28 accounts byte-identical |
| PAY-06 | C | claim for participant index 255 | `InvalidParticipantIndex` | InvalidParticipantIndex (6073) | 28 accounts byte-identical |
| PAY-07 | C/D | non-participant rotates a payout wallet | `ParticipantNotFound` | ParticipantNotFound (6032) | 28 accounts byte-identical |
| PAY-08 | C | claim to p0's stale pre-rotation ATA | `InvalidPayoutDestinationAddress` | InvalidPayoutDestinationAddress (6062) | 28 accounts byte-identical |
| PAY-09 | C/E | claim beyond remaining entitlement (no amount parameter exists) | `NoClaimableAmount` | NoClaimableAmount (6060) | 28 accounts byte-identical |
| AUTH-01 | D | non-guardian pauses claims | `Unauthorized` | Unauthorized (6010) | 28 accounts byte-identical |
| PAUSE-01 | D | claim while claims are paused | `ClaimsPaused` | ClaimsPaused (6059) | 28 accounts byte-identical |
| AUTH-02 | D | guardian attempts governance-only unpause | `Unauthorized` | Unauthorized (6010) | 28 accounts byte-identical |
| AUTH-03 | D | attacker attempts governance-only unpause | `Unauthorized` | Unauthorized (6010) | 28 accounts byte-identical |
| PAUSE-02 | D | fund_and_allocate while allocations are paused | `AllocationsPaused` | AllocationsPaused (6051) | 28 accounts byte-identical |
| PAUSE-03 | D | allocate_inbox while allocations are paused | `AllocationsPaused` | AllocationsPaused (6051) | 28 accounts byte-identical |
| STATE-01 | D | claim for fully claimed participant 0 | `NoClaimableAmount` | NoClaimableAmount (6060) | 28 accounts byte-identical |
| STATE-02 | D | claim for fully claimed participant 1 | `NoClaimableAmount` | NoClaimableAmount (6060) | 28 accounts byte-identical |
| ACCT-01 | E | zero-amount direct funding | `AllocationAmountZero` | AllocationAmountZero (6052) | 28 accounts byte-identical |
| ACCT-02 | E | allocate more than the payer actually deposits (balance + 1) | `spl-token:1` | SPL Token custom error 1 (Error: insufficient funds) | 28 accounts byte-identical |
| ACCT-03 | E | allocate u64::MAX without funds | `spl-token:1` | SPL Token custom error 1 (Error: insufficient funds) | 28 accounts byte-identical |
| STATE-PROPOSED-01 | D | fund_and_allocate against a Proposed agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-PROPOSED-02 | D | allocate_inbox against a Proposed agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-PROPOSED-03 | D | claim against a Proposed agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-PROPOSED-04 | D | initialize_royalty_inbox against a Proposed agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| AUTH-04 | D | non-participant approves a proposed agreement | `ParticipantNotFound` | ParticipantNotFound (6032) | 28 accounts byte-identical |
| AUTH-05 | D | non-manager cancels a proposed agreement | `Unauthorized` | Unauthorized (6010) | 28 accounts byte-identical |
| STATE-CANCELLED-01 | D | fund_and_allocate against a Cancelled agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-CANCELLED-02 | D | allocate_inbox against a Cancelled agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-CANCELLED-03 | D | claim against a Cancelled agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |
| STATE-CANCELLED-04 | D | initialize_royalty_inbox against a Cancelled agreement | `SettlementUnavailable` | SettlementUnavailable (6049) | 28 accounts byte-identical |

`REPLAY-01` is a byte-identical resubmission of an already-landed signed transaction; the validator refuses it as `AlreadyProcessed` before execution, so it has no fee and is evidenced by the RPC error plus the unchanged snapshot and counters.

## Positive-path security assertions

| ID | Cat. | Property | Observed |
|---|---|---|---|
| INIT-AUTH-01 | D | after rejected front-running attempts, the upgrade-authority-approved initializer holds governance | config created once; governance = authorized key |
| ISO-01 | C | a claim for p0 cannot alter p1 allocation or claim history | p1 participant state byte-identical across p0 claim |
| ENT-01 | C/E | a claim transfers exactly the remaining entitlement | p0 received 900000 = cumulative_allocated - cumulative_claimed |
| ISO-02 | C | a claim for p1 cannot alter p0 allocation or claim history | p0 participant state byte-identical across p1 claim |
| ROUTE-01 | C | post-rotation claims route only to the new canonical ATA | rotated ATA +600000; stale ATA unchanged at 900000 |
| PAUSE-SEP-01 | D | a claims pause does not block allocation | allocate_inbox succeeded while claims_paused = true |
| PAUSE-SEP-02 | D | an allocations pause does not block claims | p1 claim succeeded while allocations_paused = true |

Invariant and conservation checkpoints passed: 14 (after fixture setup; after funding #1; after raw deposit #1; after inbox allocation #1; after substitution matrix; after p0 claim #1; after p1 claim #1; after funding #2; after payout matrix; after allocation during claim pause; after claim during allocation pause; after full settlement; after accounting matrix; final).

Final predecessor agreement state: `{"cumulativeGross": "2800000", "directFundingNonce": "2", "allocationSequence": "5"}` — 2,800,000 base units allocated and fully claimed, direct-funding nonce advanced only by the two successful direct fundings, and allocation sequence advanced only by the five successful allocations.

## Coverage classification

### Proven on-chain

- Wrong settlement mint at config, inbox initialization, funding, and claim (`CFG-03`, `INIT-01`, `SUB-01`, `SUB-02`).
- Token-2022 / non-original token program at config, inbox initialization, funding, allocation, claim, and as the inbox account itself (`CFG-01`, `CFG-02`, `INIT-02`, `SUB-03`–`SUB-07`).
- Wrong vault PDA, including another agreement's vault and a wrong-seed PDA (`INIT-03`, `SUB-08`–`SUB-10`).
- Non-canonical Royalty Inbox, including a vault-owned settlement-mint decoy holding real funds (`INIT-04`, `SUB-11`–`SUB-15`).
- Payer source with the wrong mint, another owner, an SPL delegate approval, and an unsigned owner (`SUB-16`–`SUB-19`).
- Consumed and future direct-funding nonces, exact transaction replay, double allocation, and re-claim (`REPLAY-01`–`REPLAY-06`).
- Payout to another participant's ATA, an attacker ATA, an other-mint ATA, a non-canonical account owned by the right wallet, and the stale pre-rotation ATA; out-of-range participant indexes (`PAY-01`–`PAY-08`).
- Claims and allocations under the respective pauses, with pause-domain independence (`PAUSE-01`–`PAUSE-03`, `PAUSE-SEP-01/02`).
- Non-guardian pause, guardian and attacker attempts at governance-only unpause, non-participant payout rotation and approval, non-manager cancellation (`AUTH-01`–`AUTH-05`, `PAY-07`).
- Settlement and inbox initialization against Proposed and Cancelled agreements (`STATE-PROPOSED-*`, `STATE-CANCELLED-*`).
- Fully claimed participants and zero / unfunded / `u64::MAX` direct funding (`STATE-01/02`, `PAY-09`, `ACCT-01`–`ACCT-03`).
- Configuration initialization cannot be front-run. An attacker signing as upgrade authority, substituting an attacker-controlled ProgramData or program account, passing a non-loader account, or naming the real upgrade authority without its signature is rejected before the authorized initialization. The authorized initializer then holds governance (`CFG-04` to `CFG-08`, `INIT-AUTH-01`).
- Byte-level rollback for all 68 rejections; cross-participant claim isolation (`ISO-01/02`); exact conservation at 14 checkpoints.

### Proven, but by an earlier guard than the scenario names

- **Royalty Inbox wrong mint / wrong authority (`SUB-14`, `SUB-15`)** and **payout destination wrong authority / wrong mint (`PAY-02`, `PAY-03`)** are rejected on-chain by the canonical-address check (`InvalidRoyaltyInboxAddress`, `InvalidPayoutDestinationAddress`). The address is the ATA derived from (owner, token program, mint), so any account with a different mint or authority necessarily has a different address. The field-specific `InvalidRoyaltyInboxMint/Authority` and `InvalidPayoutDestinationMint/Authority` branches are defense in depth that external callers cannot reach on-chain; they are covered by the Rust unit tests in `programs/royaltyrail/src/settlement_ix.rs`.

### Not externally inducible — covered by construction and unit tests

- **Inbox insolvency (`RoyaltyInboxInsolvent`).** Under the original SPL Token Program with a mint that has no permanent-delegate concept, only the vault PDA can debit the canonical inbox, and the program debits it only through claims that reduce liabilities by the same amount. On-chain, the two ways an attacker could try to make liabilities exceed funds are rejected — allocating a funded decoy inbox (`SUB-12`) and allocating more than is actually transferred (`ACCT-02`, `ACCT-03`) — and solvency is asserted at every checkpoint. The guard itself is unit-tested (`settlement.rs::insolvency_is_rejected`).
- **Claims exceeding entitlement.** `claim_participant` takes no amount; the program always transfers exactly `cumulative_allocated − cumulative_claimed`. Over-claiming is not expressible; `ENT-01` and the `NoClaimableAmount` cases prove the computed amount and exhaustion.

## Remaining limitations and risks

1. **Freeze authority liveness (untested).** The test mint has no freeze authority. Real USDC does; a freeze of the Royalty Inbox or a payout ATA would block claims. This is a liveness dependency on the mint issuer, not a solvency or theft vector, and is outside what this matrix exercises.
2. **Funds sent to a non-settleable agreement's inbox.** `STATE-CANCELLED-*` leaves 250,000 base units in the cancelled successor's canonical inbox. Those funds cannot be allocated or claimed, and with no admin withdrawal path (by design) they are permanently locked. Integrators must only deposit to Active or Superseded agreements' inboxes. Deposits made to a Proposed agreement's inbox that is later activated were not exercised.
3. **Participant count.** The matrix uses two participants. The 16-participant maximum and its compute-unit cost for allocation and claim instructions are not exercised on-chain here.
4. **Replay window.** `REPLAY-01` covers replay while the original blockhash is valid (runtime status cache). Replay after blockhash expiry is rejected by the runtime as an unknown blockhash and was not exercised; protocol-level replay protection is the direct-funding nonce (`REPLAY-02`, `REPLAY-03`).
5. **Scope.** Local validator only, pinned toolchain only (Anchor 1.2.1, Agave 4.1.2). Token-2022 is exercised only as a rejected input. Lifecycle-consent attacks beyond the authorization cases above are covered by the Phase 3B Rust matrix (`programs/royaltyrail/tests/lifecycle_adversarial.rs`), not repeated here.
6. **Not an audit.** Passing CI is reproducible test evidence, not independent security review, legal review, or mainnet readiness.

## Reproduce

CI runs the matrix on a fresh validator in the `quay.io/ottersec/anchor:v1.2.1` container (job `localnet-e2e`, matrix entry "Local validator adversarial matrix"):

```bash
npm ci
npm install --no-save --package-lock=false @anchor-lang/core@1.2.1 @solana/web3.js@1.99.0 @solana/spl-token@0.4.15
solana-keygen new --no-bip39-passphrase --silent --force -o ~/.config/solana/id.json
solana-keygen new --no-bip39-passphrase --silent --force -o target/deploy/royaltyrail-keypair.json
anchor keys sync
anchor build
anchor test --validator legacy --skip-build --script test-adversarial
```

The suite needs a fresh ledger (ProtocolConfig is a per-deployment singleton and the matrix tests its initialization), so it runs in its own job rather than after the positive lifecycle.

Without `anchor test` (for example, on a host without IPv6, where Anchor's RPC-port probe fails), start the validator with the program preloaded as upgradeable, with the wallet as upgrade authority (`initialize_config` requires its co-signature), and run the script directly:

```bash
solana-test-validator --reset --ledger .anchor/test-ledger \
  --mint "$(solana-keygen pubkey ~/.config/solana/id.json)" \
  --upgradeable-program "$(solana-keygen pubkey target/deploy/royaltyrail-keypair.json)" target/deploy/royaltyrail.so \
  "$(solana-keygen pubkey ~/.config/solana/id.json)" &
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  node tests/e2e/adversarial-matrix.mjs
```
