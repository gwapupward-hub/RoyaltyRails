use anchor_lang::prelude::*;

use crate::{
    error::RoyaltyRailError,
    state::{AgreementStatus, AgreementVersionState, ProtocolConfigState, SCHEMA_VERSION_V1},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InboxAccounting {
    pub total_claimed: u128,
    pub allocated_unclaimed: u128,
    pub unallocated: u64,
}

pub fn require_settleable_agreement(
    config: &ProtocolConfigState,
    agreement: &AgreementVersionState,
) -> Result<()> {
    require!(
        config.schema_version == SCHEMA_VERSION_V1
            && agreement.schema_version == SCHEMA_VERSION_V1,
        RoyaltyRailError::UnsupportedSchemaVersion
    );
    require!(
        matches!(
            agreement.status,
            AgreementStatus::Active | AgreementStatus::Superseded
        ),
        RoyaltyRailError::SettlementUnavailable
    );
    require_keys_eq!(
        agreement.settlement_mint,
        config.settlement_mint,
        RoyaltyRailError::SettlementConfigMismatch
    );
    require_keys_eq!(
        agreement.token_program,
        config.token_program,
        RoyaltyRailError::SettlementConfigMismatch
    );
    Ok(())
}

pub fn validate_allocation_state(agreement: &AgreementVersionState) -> Result<u128> {
    let mut total_allocated = 0u128;
    let mut total_claimed = 0u128;

    for participant in &agreement.participants {
        require!(
            participant.cumulative_claimed <= participant.cumulative_allocated,
            RoyaltyRailError::AllocationStateInvariantViolation
        );
        total_allocated = total_allocated
            .checked_add(participant.cumulative_allocated)
            .ok_or(RoyaltyRailError::ArithmeticOverflow)?;
        total_claimed = total_claimed
            .checked_add(participant.cumulative_claimed)
            .ok_or(RoyaltyRailError::ArithmeticOverflow)?;
    }

    require!(
        total_allocated == agreement.cumulative_gross,
        RoyaltyRailError::AllocationStateInvariantViolation
    );
    require!(
        total_claimed <= agreement.cumulative_gross,
        RoyaltyRailError::AllocationStateInvariantViolation
    );

    Ok(total_claimed)
}

pub fn inbox_accounting(
    agreement: &AgreementVersionState,
    inbox_balance: u64,
) -> Result<InboxAccounting> {
    let total_claimed = validate_allocation_state(agreement)?;
    let allocated_unclaimed = agreement
        .cumulative_gross
        .checked_sub(total_claimed)
        .ok_or(RoyaltyRailError::AllocationStateInvariantViolation)?;
    let inbox_balance_u128 = u128::from(inbox_balance);

    require!(
        allocated_unclaimed <= inbox_balance_u128,
        RoyaltyRailError::RoyaltyInboxInsolvent
    );

    let unallocated_u128 = inbox_balance_u128
        .checked_sub(allocated_unclaimed)
        .ok_or(RoyaltyRailError::RoyaltyInboxInsolvent)?;
    let unallocated =
        u64::try_from(unallocated_u128).map_err(|_| RoyaltyRailError::ArithmeticOverflow)?;

    Ok(InboxAccounting {
        total_claimed,
        allocated_unclaimed,
        unallocated,
    })
}

pub fn participant_claimable(
    agreement: &AgreementVersionState,
    participant_index: u8,
    inbox_balance: u64,
) -> Result<u64> {
    let accounting = inbox_accounting(agreement, inbox_balance)?;
    let participant = agreement
        .participants
        .get(usize::from(participant_index))
        .ok_or(RoyaltyRailError::InvalidParticipantIndex)?;
    let claimable = participant
        .cumulative_allocated
        .checked_sub(participant.cumulative_claimed)
        .ok_or(RoyaltyRailError::AllocationStateInvariantViolation)?;

    require!(
        claimable <= accounting.allocated_unclaimed,
        RoyaltyRailError::AllocationStateInvariantViolation
    );

    u64::try_from(claimable).map_err(|_| RoyaltyRailError::ClaimAmountExceedsTokenWidth.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{ParticipantState, ProtocolConfigState};

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
    }

    fn config() -> ProtocolConfigState {
        ProtocolConfigState {
            schema_version: SCHEMA_VERSION_V1,
            bump: 1,
            deployment_id: [1; 32],
            governance_authority: key(2),
            guardian_authority: key(3),
            settlement_mint: key(4),
            token_program: key(5),
            agreements_paused: false,
            allocations_paused: false,
            claims_paused: false,
            created_slot: 1,
            reserved: [0; 64],
        }
    }

    fn participant(authority: u8, allocated: u128, claimed: u128) -> ParticipantState {
        ParticipantState {
            participant_authority: key(authority),
            payout_wallet: key(authority.wrapping_add(64)),
            share_units: 50_000_000,
            payout_revision: 1,
            cumulative_allocated: allocated,
            cumulative_claimed: claimed,
        }
    }

    fn agreement(status: AgreementStatus) -> AgreementVersionState {
        AgreementVersionState {
            schema_version: SCHEMA_VERSION_V1,
            bump: 1,
            revenue_pool: key(10),
            version: 1,
            predecessor_version: 0,
            status,
            settlement_mint: key(4),
            token_program: key(5),
            terms_hash: [11; 32],
            agreement_hash: [12; 32],
            participants: vec![participant(20, 60, 10), participant(21, 40, 5)],
            approval_bitmap: 0b11,
            supersession_approval_bitmap: 0,
            cumulative_gross: 100,
            direct_funding_nonce: 0,
            allocation_sequence: 0,
            created_slot: 1,
            activated_slot: 2,
            superseded_slot: 0,
            reserved: [0; 128],
        }
    }

    #[test]
    fn only_active_and_superseded_agreements_are_settleable() {
        let cfg = config();
        assert!(require_settleable_agreement(&cfg, &agreement(AgreementStatus::Active)).is_ok());
        assert!(
            require_settleable_agreement(&cfg, &agreement(AgreementStatus::Superseded)).is_ok()
        );
        assert!(require_settleable_agreement(&cfg, &agreement(AgreementStatus::Proposed)).is_err());
        assert!(require_settleable_agreement(&cfg, &agreement(AgreementStatus::Cancelled)).is_err());
    }

    #[test]
    fn settlement_config_must_match_protocol_config_exactly() {
        let cfg = config();
        let mut wrong_mint = agreement(AgreementStatus::Active);
        wrong_mint.settlement_mint = key(90);
        assert!(require_settleable_agreement(&cfg, &wrong_mint).is_err());

        let mut wrong_program = agreement(AgreementStatus::Active);
        wrong_program.token_program = key(91);
        assert!(require_settleable_agreement(&cfg, &wrong_program).is_err());
    }

    #[test]
    fn inbox_balance_splits_allocated_liability_from_unallocated_funds() {
        let a = agreement(AgreementStatus::Active);
        let accounting = inbox_accounting(&a, 125).expect("solvent inbox");
        assert_eq!(accounting.total_claimed, 15);
        assert_eq!(accounting.allocated_unclaimed, 85);
        assert_eq!(accounting.unallocated, 40);
    }

    #[test]
    fn insolvency_is_rejected() {
        let a = agreement(AgreementStatus::Active);
        assert!(inbox_accounting(&a, 84).is_err());
    }

    #[test]
    fn malformed_lifetime_accounting_is_rejected() {
        let mut claimed_over_allocated = agreement(AgreementStatus::Active);
        claimed_over_allocated.participants[0].cumulative_claimed = 61;
        assert!(validate_allocation_state(&claimed_over_allocated).is_err());

        let mut gross_mismatch = agreement(AgreementStatus::Active);
        gross_mismatch.cumulative_gross = 101;
        assert!(validate_allocation_state(&gross_mismatch).is_err());
    }

    #[test]
    fn participant_claimable_is_independent_and_u64_bounded_by_solvency() {
        let a = agreement(AgreementStatus::Active);
        assert_eq!(participant_claimable(&a, 0, 100).expect("alice claim"), 50);
        assert_eq!(participant_claimable(&a, 1, 100).expect("bob claim"), 35);
        assert!(participant_claimable(&a, 2, 100).is_err());
    }

    #[test]
    fn oversized_current_liability_cannot_pass_a_u64_inbox_solvency_check() {
        let too_large = u128::from(u64::MAX) + 1;
        let mut a = agreement(AgreementStatus::Active);
        a.participants = vec![ParticipantState {
            participant_authority: key(20),
            payout_wallet: key(84),
            share_units: 100_000_000,
            payout_revision: 1,
            cumulative_allocated: too_large,
            cumulative_claimed: 0,
        }];
        a.cumulative_gross = too_large;

        assert!(participant_claimable(&a, 0, u64::MAX).is_err());
    }

    #[test]
    fn fully_claimed_liability_allows_entire_balance_to_be_unallocated() {
        let mut a = agreement(AgreementStatus::Superseded);
        for participant in &mut a.participants {
            participant.cumulative_claimed = participant.cumulative_allocated;
        }
        let accounting = inbox_accounting(&a, 77).expect("fully claimed agreement");
        assert_eq!(accounting.allocated_unclaimed, 0);
        assert_eq!(accounting.unallocated, 77);
    }
}
