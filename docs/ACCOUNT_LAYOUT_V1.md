# RoyaltyRail Account Layout v1

Status: Phase 2 hardened freeze candidate  
Date: 2026-10-15

This document fixes serialization assumptions and maximum account sizes for the future Anchor implementation.

## 1. Serialization assumptions

V1 uses:

- Anchor default 8-byte account discriminator;
- Borsh-compatible fixed-width primitive encoding;
- `Vec<T>` with 4-byte length prefix;
- one-byte enum discriminants;
- maximum 16 participants per agreement version;
- no participant-vector length changes after agreement creation;
- zeroed reserved bytes for schema evolution.

The implementation must include test-time serialized-size assertions before deployment.

## 2. ProtocolConfig

| Field | Bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `deployment_id: [u8; 32]` | 32 |
| `governance_authority: Pubkey` | 32 |
| `guardian_authority: Pubkey` | 32 |
| `settlement_mint: Pubkey` | 32 |
| `token_program: Pubkey` | 32 |
| `agreements_paused: bool` | 1 |
| `allocations_paused: bool` | 1 |
| `claims_paused: bool` | 1 |
| `created_slot: u64` | 8 |
| `reserved: [u8; 64]` | 64 |

Maximum serialized size: **246 bytes**.

## 3. Work

| Field | Bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `origin_authority: Pubkey` | 32 |
| `manager_authority: Pubkey` | 32 |
| `pending_manager_authority: Pubkey` | 32 |
| `work_id: [u8; 32]` | 32 |
| `metadata_hash: [u8; 32]` | 32 |
| `metadata_version: u32` | 4 |
| `created_slot: u64` | 8 |
| `updated_slot: u64` | 8 |
| `reserved: [u8; 64]` | 64 |

Maximum serialized size: **255 bytes**.

`origin_authority` is immutable because it participates in Work PDA derivation. `manager_authority` may rotate through the two-step manager-transfer flow without changing the PDA.

## 4. RevenuePool

| Field | Bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `work: Pubkey` | 32 |
| `manager_authority: Pubkey` | 32 |
| `pending_manager_authority: Pubkey` | 32 |
| `pool_id: [u8; 32]` | 32 |
| `pool_kind` | 1 |
| `settlement_basis` | 1 |
| `metadata_hash: [u8; 32]` | 32 |
| `latest_version: u32` | 4 |
| `active_version: u32` | 4 |
| `pending_version: u32` | 4 |
| `created_slot: u64` | 8 |
| `reserved: [u8; 64]` | 64 |

Maximum serialized size: **257 bytes**.

## 5. Participant

`Participant` is embedded inside `AgreementVersion`.

| Field | Bytes |
|---|---:|
| `participant_authority: Pubkey` | 32 |
| `payout_wallet: Pubkey` | 32 |
| `share_units: u32` | 4 |
| `payout_revision: u32` | 4 |
| `cumulative_allocated: u128` | 16 |
| `cumulative_claimed: u128` | 16 |

Serialized size:

```text
104 bytes
```

Maximum participant vector:

```text
4-byte Vec prefix + (16 × 104) = 1,668 bytes
```

`share_units` uses the canonical scale:

```text
100,000,000 = 100%
1 = 0.000001%
```

Economic hashing uses only:

```text
participant_authority
share_units
```

Detailed creative roles/credits are manifest metadata anchored by `terms_hash`.

## 6. AgreementVersion

| Field | Max bytes |
|---|---:|
| discriminator | 8 |
| `schema_version: u16` | 2 |
| `bump: u8` | 1 |
| `revenue_pool: Pubkey` | 32 |
| `version: u32` | 4 |
| `predecessor_version: u32` | 4 |
| `status` | 1 |
| `settlement_mint: Pubkey` | 32 |
| `token_program: Pubkey` | 32 |
| `terms_hash: [u8; 32]` | 32 |
| `agreement_hash: [u8; 32]` | 32 |
| `participants: Vec<Participant>` | 1,668 |
| `approval_bitmap: u16` | 2 |
| `supersession_approval_bitmap: u16` | 2 |
| `cumulative_gross: u128` | 16 |
| `direct_funding_nonce: u64` | 8 |
| `allocation_sequence: u64` | 8 |
| `created_slot: u64` | 8 |
| `activated_slot: u64` | 8 |
| `superseded_slot: u64` | 8 |
| `reserved: [u8; 128]` | 128 |

Maximum serialized size with 16 participants:

```text
2,036 bytes
```

Agreement account is allocated once at proposal time. V1 should prefer fixed max-size allocation unless rent benchmarking provides a compelling reason for participant-count-specific sizing.

No v1 instruction may change participant vector length.

## 7. Approval bitmap edge case

```text
if participant_count == 16:
    required_mask = u16::MAX
else:
    required_mask = (1u16 << participant_count) - 1
```

Dedicated tests are required for new-participant approval, predecessor supersession approval, and one-participant mask `0b1`.

## 8. Cumulative accounting width

Actual SPL token transfer amounts are `u64`. Lifetime values use `u128`:

```text
cumulative_gross
participant.cumulative_allocated
participant.cumulative_claimed
```

Every narrowing conversion to `u64` must be checked.

The `u32` share field and `u64` allocation amount product fit safely inside checked `u128` arithmetic under v1 bounds.

## 9. Claimability arithmetic

```text
claimable = cumulative_allocated - cumulative_claimed
sum(cumulative_allocated) == cumulative_gross
allocated_unclaimed = cumulative_gross - sum(cumulative_claimed)
inbox_balance >= allocated_unclaimed
```

Because `inbox_balance` is an SPL-token `u64`, every individual current claimable amount is necessarily within `u64` in a valid solvent state.

## 10. Reserved storage policy

Reserved bytes initialize to zero. Ordinary v1 instructions leave them unchanged. Future schema versions may interpret them only through explicit reviewed migration/version logic and never to rewrite existing economics.

## 11. Royalty Inbox storage

Royalty Inbox is not an Anchor-owned state account. It is an original SPL Token ATA for configured USDC, owned by agreement-version vault PDA:

```text
[b"vault", agreement_version]
```

No separate rent-bearing VaultAuthority account is allocated.

## 12. Account closure policy

RoyaltyRail-owned Work, RevenuePool, AgreementVersion, and Royalty Inbox accounts are not closed through v1 instructions. This preserves historical integrity and avoids introducing rent-recovery paths that could become custody/withdrawal primitives.

## 13. Size verification gate

Before Anchor implementation PR can merge, CI must serialize and assert maximum sizes for:

```text
ProtocolConfig
Work
RevenuePool
AgreementVersion (16 participants)
```

The test must fail if a struct changes without corresponding account-size/spec updates.
