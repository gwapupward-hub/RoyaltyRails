# RoyaltyRail Account Layout v1

Status: Phase 2 specification freeze candidate  
Date: 2026-10-14

This document fixes serialization assumptions and maximum account sizes for the future Anchor implementation.

## 1. Serialization assumptions

V1 uses:

- Anchor default 8-byte account discriminator;
- Borsh-compatible fixed-width primitive encoding;
- `Vec<T>` with a 4-byte length prefix;
- one-byte enum discriminants for the v1 enums;
- no optional dynamically growing participant arrays after initialization;
- maximum 16 participants per agreement version.

The Anchor implementation must include compile-time or test-time assertions that serialized maximum lengths match the values below before deployment.

If the selected Anchor release changes a serialization assumption, these sizes must be recalculated and the spec updated before implementation proceeds.

## 2. `ProtocolConfig`

Fields excluding discriminator:

| Field | Bytes |
|---|---:|
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `admin_authority: Pubkey` | 32 |
| `settlement_mint: Pubkey` | 32 |
| `token_program: Pubkey` | 32 |
| `agreements_paused: bool` | 1 |
| `settlements_paused: bool` | 1 |
| `created_slot: u64` | 8 |

Maximum serialized account size including discriminator:

```text
117 bytes
```

## 3. `Work`

| Field | Bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `authority: Pubkey` | 32 |
| `work_id: [u8; 32]` | 32 |
| `metadata_hash: [u8; 32]` | 32 |
| `metadata_version: u32` | 4 |
| `created_slot: u64` | 8 |
| `updated_slot: u64` | 8 |

Maximum serialized size:

```text
127 bytes
```

## 4. `RevenuePool`

V1 enum fields are one-byte discriminants.

| Field | Bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `work: Pubkey` | 32 |
| `authority: Pubkey` | 32 |
| `pool_id: [u8; 32]` | 32 |
| `pool_kind` | 1 |
| `settlement_basis` | 1 |
| `metadata_hash: [u8; 32]` | 32 |
| `latest_version: u32` | 4 |
| `active_version: u32` | 4 |
| `pending_version: u32` | 4 |
| `created_slot: u64` | 8 |

Maximum serialized size:

```text
161 bytes
```

## 5. `Participant`

`Participant` is embedded inside `AgreementVersion` and has no Anchor account discriminator.

| Field | Bytes |
|---|---:|
| `participant_authority: Pubkey` | 32 |
| `payout_wallet: Pubkey` | 32 |
| `share_bps: u16` | 2 |
| `role_code: u16` | 2 |

Serialized size:

```text
68 bytes
```

Maximum participant vector:

```text
4-byte Vec prefix + (16 × 68) = 1,092 bytes
```

## 6. `AgreementVersion`

| Field | Max bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `revenue_pool: Pubkey` | 32 |
| `version: u32` | 4 |
| `status` | 1 |
| `settlement_mint: Pubkey` | 32 |
| `token_program: Pubkey` | 32 |
| `terms_hash: [u8; 32]` | 32 |
| `agreement_hash: [u8; 32]` | 32 |
| `participants: Vec<Participant>` | 1,092 |
| `approval_bitmap: u16` | 2 |
| `cumulative_gross: u128` | 16 |
| `cumulative_paid: Vec<u128>` | 260 |
| `direct_settlement_nonce: u64` | 8 |
| `settlement_sequence: u64` | 8 |
| `created_slot: u64` | 8 |
| `activated_slot: u64` | 8 |
| `superseded_slot: u64` | 8 |

Maximum serialized size with 16 participants:

```text
1,586 bytes
```

The account is allocated once at proposal time for its actual participant count or, preferably for simpler size invariants in v1, at the fixed maximum supported size. The final implementation choice must be benchmarked for rent and simplicity before Gate 3.

No v1 instruction may increase or decrease the participants or cumulative-paid vector lengths after account creation.

## 7. Approval bitmap edge case

A 16-participant agreement uses all bits of a `u16`.

The required approval mask MUST be computed without shifting a `u16` by 16.

Safe conceptual logic:

```text
if participant_count == 16:
    required_mask = u16::MAX
else:
    required_mask = (1u16 << participant_count) - 1
```

This case requires a dedicated unit test.

## 8. Cumulative accounting width

SPL Token transfer amounts are `u64`, but lifetime cumulative totals use `u128` so an agreement is not unnecessarily bounded by the aggregate of many valid `u64` settlements.

Every conversion from `u128` to `u64` must be checked.

The settlement engine must never truncate cumulative values.

## 9. Account allocation policy

V1 does not use subtractive reallocation.

No RoyaltyRail account intentionally holding program state should depend on reclaiming rent during normal operation.

Agreement, RevenuePool and Work accounts are not closed in v1.

## 10. Royalty Inbox storage

The Royalty Inbox is not an Anchor-owned account. It is an SPL Token Associated Token Account for the configured settlement mint, with the agreement-version vault PDA as token authority.

No separate rent-bearing `VaultAuthority` state account is allocated.

## 11. Size verification gate

Before Anchor implementation PR may be merged, CI must include tests that serialize maximum-size account values and assert they fit the allocated `space` for:

```text
ProtocolConfig
Work
RevenuePool
AgreementVersion (16 participants)
```

The test must fail if a struct changes without a corresponding allocation/spec update.
