# RoyaltyRail Security Model v1

Status: Phase 2 specification freeze candidate  
Date: 2026-10-14

This document defines the minimum security properties required before RoyaltyRail may progress from specification into Anchor implementation and later toward mainnet.

## 1. Security objective

RoyaltyRail must ensure that once a valid agreement version is approved and activated:

> Funds routed through that version can only be distributed according to the exact stored agreement and reference accounting rules.

The strongest v1 guarantee is not that RoyaltyRail can determine the correct legal royalty agreement. The guarantee is that RoyaltyRail cannot silently change or misexecute an agreement the participants approved.

## 2. Trust boundaries

### Trusted for v1 correctness

- Solana runtime transaction atomicity;
- deployed RoyaltyRail program bytecode;
- original SPL Token Program;
- configured settlement mint;
- program-derived address derivation;
- the merged reference accounting specification;
- participant wallet signatures on approval transactions.

### Not trusted

- RoyaltyRail Studio frontend;
- RoyaltyRail API;
- RoyaltyRail indexer;
- RPC providers;
- agreement proposer;
- settlement triggerer;
- direct payer;
- protocol admin;
- external metadata hosts;
- email invitation systems;
- any account merely because a caller labels it as a recipient or vault.

The program must verify security-critical facts independently from client claims.

## 3. Asset security boundary

V1 accepts exactly one configured settlement mint per deployment.

The mint is immutable after `initialize_protocol`.

Mainnet configuration must use the explicitly approved native Solana USDC mint and original SPL Token Program.

The program rejects:

- lookalike tokens;
- arbitrary caller-provided mints;
- token accounts belonging to another mint;
- Token-2022 accounts in v1;
- source/destination accounts that are not the exact expected ATAs.

## 4. No-custodial-admin invariant

RoyaltyRail administrators must have no instruction capable of directing Royalty Inbox funds to an arbitrary address.

Forbidden administrative primitives include any equivalent of:

```text
withdraw_vault(destination)
rescue_tokens(destination)
override_recipient(destination)
force_settle(custom_amounts)
edit_share(participant, bps)
change_payout_wallet(participant, wallet)
```

If funds are in a canonical Royalty Inbox, v1 permits only deterministic settlement to canonical participant ATAs according to that agreement version.

This invariant must be tested from program instruction inventory and CPI call sites, not merely documented.

## 5. Threat actors

### Malicious proposer

May attempt to:

- duplicate a participant;
- manipulate participant ordering to influence rounding;
- submit shares totaling something other than 100%;
- substitute payout wallets;
- omit an expected participant;
- change terms after some approvals;
- activate without unanimous approval.

Mitigations:

- strictly sorted unique participant authorities;
- exact 10,000 BPS requirement;
- immutable proposal contents;
- canonical agreement hash;
- participant approval of expected hash;
- unanimous bitmap requirement;
- versioned amendments.

### Malicious participant

May attempt to:

- approve for another participant;
- replay approval;
- mutate payout accounts during settlement;
- reject an already-active agreement;
- submit malformed remaining accounts.

Mitigations:

- signer must equal stored participant authority;
- one approval bit per participant;
- active/superseded versions immutable;
- exact recipient ATA derivation checks;
- canonical account ordering.

### Malicious direct payer

May attempt to:

- replay a payment intent;
- pay through the wrong token account;
- choose custom payout destinations;
- pass an incorrect mint;
- underflow/overflow settlement state;
- provide fewer/more recipient accounts than required.

Mitigations:

- expected direct-settlement nonce;
- payer canonical ATA validation;
- fixed configured mint;
- recipient count/order validation;
- checked arithmetic;
- program-computed payouts only.

### Malicious inbox settler

May attempt to:

- redirect inbox funds;
- partially settle favorable amounts;
- choose payout destinations;
- settle a zero balance;
- settle a Proposed/Cancelled agreement.

Mitigations:

- caller supplies no payout vector;
- caller supplies no amount;
- full inbox balance is the amount;
- exact canonical inbox validation;
- program computes all outputs;
- settlement-status checks.

### Compromised protocol admin

May attempt to:

- seize funds;
- change mint;
- edit agreements;
- permanently freeze users;
- use pause state as a withdrawal mechanism.

Mitigations:

- admin instruction surface restricted to pause state;
- immutable settlement mint/token program;
- no withdrawal primitive;
- production admin must be a hardened multisig/governed authority;
- settlement pause creates no transfer authority;
- incident-response documentation and review required before mainnet.

### Compromised upgrade authority

This is a critical deployment-layer threat because an upgradeable program can change code regardless of application-level restrictions.

Before mainnet beta:

- upgrade authority must not be a single hot wallet;
- authority must be moved to an approved multisig/governance configuration;
- upgrade procedure must be documented;
- upgrade access must be independently reviewed;
- production monitoring must detect program-data changes;
- a future immutability/timelock policy must be explicitly decided before large value is accepted.

## 6. Account substitution threats

Solana programs receive caller-selected accounts. RoyaltyRail must never trust account position alone.

Required checks include:

### Config

- exact `[b"config"]` PDA;
- owned by RoyaltyRail program;
- expected schema version.

### Work

- exact PDA seeds;
- expected authority relation when relevant.

### RevenuePool

- exact PDA seeds;
- stored parent Work matches supplied Work;
- stored authority relationship valid.

### AgreementVersion

- exact PDA seeds from pool + version;
- stored parent pool matches supplied pool;
- status eligible for called instruction.

### Vault authority

- exact `[b"vault", agreement_version]` PDA and canonical bump.

### Settlement mint

- exact stored/configured mint;
- owned by expected token program;
- matches every source/destination token account.

### Payer token account

- exact ATA for payer + configured mint + configured token program.

### Royalty Inbox

- exact ATA for vault authority + configured mint + configured token program.

### Recipient token accounts

For every participant index:

- exact canonical ATA derived from stored payout wallet;
- correct mint;
- correct token-account authority;
- expected token-program ownership;
- exact canonical ordering.

## 7. Agreement-hash security

The agreement hash binds all economically relevant terms needed for v1 execution.

Hashing rules:

- fixed domain separator;
- program ID included;
- pool address included;
- version included;
- settlement mint/token program included;
- pool type/basis/immutable metadata hash included;
- terms hash included;
- participant count included;
- canonical ordered participant authority, payout wallet, BPS and role included;
- fixed-width binary encoding;
- SHA-256;
- never JSON/string-map serialization.

Participant approval instruction includes the hash it expects.

If the stored hash differs, approval fails.

This prevents a UI from obtaining a signature while displaying terms for one hash and approving another unnoticed by a conforming wallet/client integration.

## 8. Arithmetic security

The Rust implementation must match the TypeScript reference engine.

Requirements:

- no floating-point arithmetic;
- no unchecked integer arithmetic;
- no unchecked narrowing conversions;
- settlement input amounts are positive `u64`;
- cumulative totals are checked `u128`;
- per-recipient transfer outputs are checked to fit `u64`;
- exact conservation on every successful settlement;
- no participant receives a negative/clawback delta;
- bounded lifetime rounding error remains below one base unit per participant;
- cumulative paid must exactly equal cumulative gross after every successful settlement.

Any invariant failure aborts the transaction before durable state change.

## 9. Replay security

### Approval replay

Approval of an already-approved participant bit fails.

Approval of a different agreement version requires a new transaction against a different PDA/hash.

### Direct settlement replay

A direct settlement consumes exactly one expected nonce.

A new transaction using an old nonce fails even if it uses a fresh blockhash/signature.

### Inbox replay

Inbox settlement always uses the actual full token balance. A successful flush removes the amount it settled. A repeated call against a zero inbox fails.

## 10. Concurrent execution

Mutable Solana account locking provides serialization for the same agreement account within concurrent transactions.

RoyaltyRail additionally verifies explicit state:

- direct nonce;
- pool pending/active version pointers;
- agreement status;
- current inbox balance.

Concurrency tests must cover:

- two direct settlements with same nonce;
- two direct settlements with consecutive intended nonces racing;
- two inbox flushes racing;
- activation racing cancellation;
- activation racing rejection;
- proposal creation racing another proposal;
- settlement of old version while new version activates.

## 11. Pause threat model

Pause controls are designed to stop execution, not transfer custody.

`agreements_paused` and `settlements_paused` must be independent.

The admin cannot use pause to:

- change payout destinations;
- alter balances;
- close inbox accounts;
- increment accounting;
- cancel active agreements.

Before production, operational policy must define:

- who can pause;
- threshold/signers;
- incident conditions;
- public communication process;
- criteria for resumption;
- post-incident review.

## 12. Royalty Inbox dust and spam

Any party may send configured USDC to a public Royalty Inbox.

This is a feature, but it means unsolicited micro-deposits are possible.

V1 behavior:

- any positive inbox balance is settleable;
- caller pays transaction fees to trigger `settle_inbox`;
- the accounting engine safely handles micro-payments;
- there is no minimum economic threshold enforced on-chain in v1;
- Studio automation may choose operational batching thresholds without changing protocol eligibility.

Because only configured USDC can exist in the inbox ATA, arbitrary non-USDC tokens cannot be deposited into that token account.

Unrelated SOL sent to the PDA address is outside the USDC settlement model and must not create a withdrawal path in v1.

## 13. Recipient ATA closure

A recipient may close its empty ATA outside RoyaltyRail.

V1 settlement fails if a required canonical ATA does not exist.

The SDK/Studio may permissionlessly recreate the ATA using the Associated Token Program before retrying settlement.

Settlement itself does not create ATAs, keeping the money-moving instruction smaller and easier to audit.

## 14. Unexpected token behavior

V1 is intentionally limited to the original SPL Token Program and the configured native USDC mint.

The program must not attempt to generically support:

- transfer-fee tokens;
- transfer hooks;
- confidential transfers;
- rebasing semantics;
- arbitrary Token-2022 extensions;
- frozen/blacklisted custom tokens.

Support for another asset requires a separate protocol review because token behavior can invalidate simple conservation assumptions.

## 15. CPI policy

V1 should keep CPIs minimal.

Expected external programs:

- System Program where account creation requires it;
- Associated Token Program for inbox initialization;
- original SPL Token Program for USDC transfers.

No caller-supplied arbitrary CPI target is permitted.

Every external program account must be constrained to the exact expected program ID.

## 16. Reentrancy / callback surface

V1 uses the original SPL Token Program, which does not provide Token-2022 Transfer Hook callbacks.

No user-selected callback/program execution should occur during settlement.

This materially reduces reentrancy-like composability risk for v1.

If Token-2022 or callback-capable assets are ever supported, a new threat model is mandatory.

## 17. Denial-of-service considerations

Potential DoS surfaces:

- recipient closes ATA;
- account list deliberately malformed;
- compute limit exceeded for large participant count;
- transaction size exceeded;
- RPC/indexer unavailable;
- admin settlement pause;
- upgrade authority compromised.

Mitigations:

- 16-recipient cap;
- recipient ATA preflight preparation;
- localnet/devnet compute benchmarks before mainnet;
- permissionless inbox settlement;
- indexer is non-authoritative;
- protocol remains directly callable without Studio/API;
- pause/upgrade authority hardening before production.

## 18. Data privacy

No sensitive PII belongs in v1 on-chain accounts.

Forbidden on-chain product fields include:

- tax IDs;
- government IDs;
- bank-account numbers;
- home addresses;
- private contract text;
- email addresses unless a future privacy review explicitly permits it.

Only hashes/identifiers necessary for integrity and execution belong on-chain.

## 19. Security invariants

The implementation test suite must encode at least:

### S-001 Conservation

```text
sum(current payouts) == settlement amount
```

### S-002 Share total

```text
sum(shares) == 10_000 BPS
```

### S-003 Unique authority

No duplicate participant authority is accepted.

### S-004 Canonical order

Unsorted participant arrays are rejected.

### S-005 Approval integrity

Activation is impossible without every participant's approval bit.

### S-006 Hash integrity

Approval fails when the supplied expected hash differs from stored hash.

### S-007 Economic immutability

Active/superseded agreement economic fields cannot change in-place.

### S-008 Mint integrity

Settlement only uses configured mint/token program.

### S-009 Destination integrity

Every transfer destination is the exact participant ATA derived from stored payout wallet.

### S-010 Source integrity

Direct payer and inbox sources are exact canonical token accounts.

### S-011 No admin seizure

No v1 instruction controlled by admin can transfer inbox funds.

### S-012 Non-negative payout

No settlement computes a negative participant delta.

### S-013 Checked arithmetic

Overflow/underflow aborts.

### S-014 Direct replay resistance

Consumed direct nonce cannot succeed again.

### S-015 Inbox full-flush

Successful inbox settlement transfers exactly the balance observed for settlement.

### S-016 Historical version integrity

Superseding a version cannot alter its accounting or payout terms.

### S-017 Pause isolation

Pause instructions change only permitted pause state.

### S-018 Permissionless liveness

Inbox settlement correctness does not depend on RoyaltyRail backend authorization.

## 20. Pre-mainnet security gate

RoyaltyRail must not accept production royalties until all are complete:

- full Anchor unit/integration tests;
- local-validator adversarial suite;
- devnet soak tests;
- canonical TypeScript/Rust vector parity;
- compute and transaction-size benchmarks at max 16 participants;
- dependency/toolchain pinning;
- reproducible build process;
- program deployment key/upgrade authority policy;
- production multisig;
- monitoring and alerting;
- incident-response runbook;
- independent smart-contract security review;
- legal architecture review;
- explicit mainnet deployment checklist and sign-off.

Green CI alone is not mainnet readiness.
