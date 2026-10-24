# RoyaltyRail Governance Recovery v1 (design)

Status: **Draft — design only. No program change is proposed for the current devnet deployment.**

RoyaltyRails is devnet-only and unaudited. This document analyzes one risk and recommends a direction for the mainnet design. It authorizes nothing.

## 1. Problem

`ProtocolConfig.governance_authority` is set once by `initialize_config` and no instruction can change it ([DEPLOYMENT_DEVNET_V1.md](DEPLOYMENT_DEVNET_V1.md), unresolved risk 5). The relevant code paths in `programs/royaltyrail/src/lib.rs`:

| Instruction | Who | Effect |
| --- | --- | --- |
| `guardian_pause` | `guardian_authority` | Sets any of `agreements_paused`, `allocations_paused`, `claims_paused` from false to true only. |
| `governance_set_pauses` | `governance_authority` (`require_governance`) | Sets all three flags to any value. **This is the only unpause path.** |
| `rotate_guardian` | `governance_authority` | Replaces the guardian. |
| _(none)_ | — | Nothing rotates governance. |

`claim_participant` requires `!claims_paused` (`claims.rs`). Allocation requires `!allocations_paused` (`settlement.rs`).

**Failure scenario.** The guardian pauses claims, for example during an incident. Then the governance key is lost or destroyed. No signer can ever clear `claims_paused`, so every participant's allocated-unclaimed balance in every Royalty Inbox is permanently locked. If allocations were also paused, unallocated deposits are locked too. A compromised or careless guardian can turn a lost governance key into a protocol-wide permanent freeze, because the guardian can still pause.

Only one escape exists today: the **upgrade authority** can replace the bytecode ([SECURITY_V1.md](SECURITY_V1.md) §23). That is a superuser repair, not a recovery design, and it disappears once the program is made immutable.

### Fixed constraints

- `MutateConfig.authority` is a plain `Signer`. A PDA that signs by CPI (for example a multisig vault) satisfies it without code changes.
- `ProtocolConfig` is a per-deployment singleton at `[b"config"]`, 246 bytes, with `reserved: [u8; 64]` ([ACCOUNT_LAYOUT_V1.md](ACCOUNT_LAYOUT_V1.md) §2).
- Neither governance nor guardian may move funds or change economics (§22). Every option below must keep that invariant.

## 2. Options

Each option is assessed on four points:

- **Attack surface:** what a hostile party gains.
- **Failure modes:** how it can still lock funds.
- **On-chain delta:** what must change in program code or accounts.
- **New deployment:** whether the existing program ID and ProtocolConfig can be kept.

### Option A — Governance is an M-of-N multisig with recovery signers

Initialize `governance_authority` as the vault PDA of an audited multisig program, such as Squads v4. The members are M-of-N operational signers. Optionally the multisig has its own member-rotation or recovery signers, with a time lock on membership changes.

- **Attack surface.** Shifts from one key to M keys plus the multisig program's own code and upgrade authority. Recovery signers are a standing threshold-compromise target; colluding M-of-N members gain full governance (unpause and guardian rotation, but still no fund movement). Multisig UI or transaction-simulation spoofing becomes relevant.
- **Failure modes.**
  - If more than N−M keys are lost, governance is lost and the original problem returns.
  - If the multisig program is upgraded maliciously or frozen, governance follows it.
  - Membership rotation lives entirely in the multisig, so RoyaltyRails cannot audit it on-chain.
- **On-chain delta.** **None in RoyaltyRails.** `require_governance` compares a pubkey to a `Signer`, and a CPI-signed vault PDA passes. The change is operational: initialization procedure, signer custody, and runbooks.
- **New deployment.** **Yes** for any deployment whose governance is already a single key, including the current devnet one. Governance cannot be re-pointed and ProtocolConfig cannot be re-initialized, so there must be a fresh program ID, or an upgrade-authority bytecode change, which is Option B in disguise. For mainnet it costs nothing extra: set it correctly at first initialization.

### Option B — Governed two-step rotation

Add two instructions:

- `propose_governance(new)`, signed by current governance. It stores `pending_governance`.
- `accept_governance()`, signed by `pending_governance`. It moves pending to active and emits an event.

Optionally add `cancel_governance_proposal`. Keep the existing rules: nonzero, governance ≠ guardian, no-op rotation rejected.

- **Attack surface.** A compromised governance key can now hand governance to an attacker permanently. Today a compromised key can do everything governance does, but cannot transfer itself. The two-step accept prevents typos and dead-key transfers only; it does not stop a malicious transfer. Monitoring of `GovernanceProposed` and `GovernanceAccepted` events is required.
- **Failure modes.** **Does not solve key loss.** Rotation needs the current governance signature, which is exactly what is lost. It only reduces how often loss happens, because keys can be refreshed routinely. A pending proposal to a key that is then also lost is harmless: it is never accepted.
- **On-chain delta.** Two or three new instructions, two new events, and a `pending_governance: Pubkey` field that fits in `reserved` (32 of 64 bytes, account size unchanged). Requires a schema-version decision, IDL change, tests, and audit. It changes the SBF, so the frozen manifest must be regenerated.
- **New deployment.** **No** if the program is upgraded in place by its upgrade authority, since the reserved bytes absorb the new field. That is still a program upgrade with the full upgrade-authority trust implications. For a fresh mainnet deployment it is simply part of v1.x.

### Option C — Guardian-initiated, time-delayed fallback unpause

Add two instructions:

- `guardian_request_unpause(flags)`. It records `unpause_requested_at` and the requested flags.
- `guardian_execute_unpause()`. After a fixed delay D (for example 14 days), it clears those flags.

Governance can veto at any time during D by calling `governance_set_pauses` or a dedicated cancel. Optionally the fallback is allowed only when governance has been silent, with no governance instruction for a period T.

- **Attack surface.** A compromised guardian gains a delayed unpause. That is the main concern: an incident pause can be undone by the attacker if governance is gone or asleep for D. A guardian can also spam requests that force governance to keep vetoing (griefing), which needs a cooldown. Delay parameters become security-critical constants. The guardian becomes a liveness recovery role as well as a safety role, which weakens the separation in §22.
- **Failure modes.**
  - Losing governance and the guardian together still locks funds. The guardian can be rotated only by governance, so losing the guardian while governance is lost is terminal.
  - Clock and slot assumptions: use `Clock::unix_timestamp` with conservative D.
  - If D is too short, the pause loses its value as an incident tool. If D is too long, claimants wait.
- **On-chain delta.** Two or three new instructions, new events, and `unpause_requested_at: i64` plus requested-flags bits in `reserved`. Requires careful interaction rules with `guardian_pause` (does a new pause cancel a pending unpause?), tests, and audit.
- **New deployment.** **No** if upgraded in place via the reserved bytes, with the same caveats as Option B.

### Option D — Explicitly accept no recovery

Keep v1 semantics. Treat governance-key loss as terminal for that deployment. Mitigate operationally: hardware-backed, geographically separated, backup-verified governance custody; a documented rule that the guardian pauses claims only with governance actively reachable; and public disclosure.

- **Attack surface.** Unchanged from today and minimal on-chain: no new code paths.
- **Failure modes.** The failure scenario in §1 stays possible and is permanent once the program is immutable. Pause claims and then lose governance, and all allocated-unclaimed balances lock. That is a disclosed but unbounded liveness loss for third-party funds.
- **On-chain delta.** None.
- **New deployment.** No.

## 3. Comparison

| | A. Multisig | B. Two-step rotation | C. Guardian fallback unpause | D. Accept |
| --- | --- | --- | --- | --- |
| Solves loss of a single key | Yes (up to N−M) | No (only enables routine rotation) | Yes, for unpause only | No |
| Solves loss of all governance | No | No | Yes, for unpause only | No |
| New on-chain code | No | Yes | Yes | No |
| New attack surface in RoyaltyRails | None | Self-transfer of governance | Guardian can unpause after D | None |
| Needs new deployment for current devnet | Yes | No (upgrade) | No (upgrade) | No |
| Keeps §22 role separation | Yes | Yes | Weakens it | Yes |

## 4. Recommendation

**Adopt Option A for every mainnet deployment, and add Option B in the next program version.**

- Option A removes single-key loss as a realistic event with **zero new program code**. It can be done at mainnet initialization without touching the audited settlement surface.
- Option B lets the multisig itself be replaced, for example after member churn, a multisig-program migration, or a suspected compromise, without a redeploy. The two-step accept guards against handing governance to a dead or typo'd key. Its self-transfer risk is acceptable because the governance it transfers can still neither move funds nor change economics.
- **Reject Option C** for v1.x. It makes a compromised guardian able to reverse incident pauses, which inverts the guardian's purpose. Reconsider only if Option A is impossible.
- **Option D remains the status quo for the current devnet deployment** (devnet value is nil). Its governance key was handled under the devnet custody exception ([PHASE_3D.md](PHASE_3D.md) Stage 3D.4) and must not be carried forward.

The current devnet deployment is **not** changed by this recommendation.

## 5. Mainnet-gate items this adds

These extend [SECURITY_V1.md](SECURITY_V1.md) §33 ("hardened governance/guardian/upgrade policy") and do not replace any existing gate:

- [ ] `governance_authority` at mainnet initialization is the vault of an audited M-of-N multisig (M ≥ 2, N ≥ 3). Its program ID, version, and upgrade status are recorded.
- [ ] Multisig members' keys are owner-custodied on separate hardware, with backups verified by re-entry. No key is generated or handled in an agent or CI environment.
- [ ] The multisig's membership-change and threshold-change process is documented, time-locked where the multisig supports it, and rehearsed on devnet.
- [ ] Governance rotation (Option B) is implemented, adversarially tested, and audited, or its absence is explicitly accepted in the mainnet sign-off.
- [ ] A runbook states that the guardian pauses claims only while governance quorum is confirmed reachable, and sets the maximum response time for governance to unpause.
- [ ] Monitoring alerts on `PauseFlagsUpdated`, `GuardianUpdated`, and (once added) governance-rotation events.
- [ ] Governance-loss and multisig-compromise drills, from pause to unpause through the multisig, pass on devnet against the frozen mainnet candidate build.
- [ ] Public disclosure of governance and pause powers, including that the guardian can pause claims and only governance can unpause.

## 6. Out of scope

- Upgrade-authority hardening (multisig, timelock, ProgramData monitoring, eventual immutability) is tracked in [SECURITY_V1.md](SECURITY_V1.md) §23. It interacts with every option, because while the program is upgradeable the upgrade authority can always repair governance.
- Any emergency fund-recovery or admin-withdrawal path. v1 excludes it by design and this document does not propose one.
