use anchor_lang::prelude::*;

use crate::{
    error::RoyaltyRailError,
    settlement::{participant_claimable, require_settleable_agreement, validate_allocation_state},
    state::{AgreementVersionState, ProtocolConfigState},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PreparedClaim {
    pub participant_index: u8,
    pub participant_authority: Pubkey,
    pub payout_wallet: Pubkey,
    pub payout_revision: u32,
    pub prior_allocated: u128,
    pub prior_claimed: u128,
    pub amount: u64,
    pub next_claimed: u128,
}

pub fn require_claims_enabled(config: &ProtocolConfigState) -> Result<()> {
    require!(!config.claims_paused, RoyaltyRailError::ClaimsPaused);
    Ok(())
}

pub fn prepare_participant_claim(
    config: &ProtocolConfigState,
    agreement: &AgreementVersionState,
    participant_index: u8,
    inbox_balance: u64,
) -> Result<PreparedClaim> {
    require_settleable_agreement(config, agreement)?;
    require_claims_enabled(config)?;

    let amount = participant_claimable(agreement, participant_index, inbox_balance)?;
    require!(amount > 0, RoyaltyRailError::NoClaimableAmount);

    let participant = agreement
        .participants
        .get(usize::from(participant_index))
        .ok_or(RoyaltyRailError::InvalidParticipantIndex)?;
    require!(
        participant.payout_wallet != Pubkey::default() && participant.payout_revision > 0,
        RoyaltyRailError::PayoutRouteUninitialized
    );
    let next_claimed = participant
        .cumulative_claimed
        .checked_add(u128::from(amount))
        .ok_or(RoyaltyRailError::ArithmeticOverflow)?;
    require!(
        next_claimed <= participant.cumulative_allocated,
        RoyaltyRailError::AllocationStateInvariantViolation
    );

    Ok(PreparedClaim {
        participant_index,
        participant_authority: participant.participant_authority,
        payout_wallet: participant.payout_wallet,
        payout_revision: participant.payout_revision,
        prior_allocated: participant.cumulative_allocated,
        prior_claimed: participant.cumulative_claimed,
        amount,
        next_claimed,
    })
}

pub fn apply_prepared_claim(
    agreement: &mut AgreementVersionState,
    prepared: &PreparedClaim,
) -> Result<()> {
    let participant = agreement
        .participants
        .get_mut(usize::from(prepared.participant_index))
        .ok_or(RoyaltyRailError::InvalidParticipantIndex)?;

    require!(
        participant.participant_authority == prepared.participant_authority
            && participant.payout_wallet == prepared.payout_wallet
            && participant.payout_revision == prepared.payout_revision
            && participant.cumulative_allocated == prepared.prior_allocated
            && participant.cumulative_claimed == prepared.prior_claimed,
        RoyaltyRailError::StalePreparedClaim
    );

    participant.cumulative_claimed = prepared.next_claimed;
    validate_allocation_state(agreement)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        settlement::inbox_accounting,
        state::{AgreementStatus, ParticipantState, SCHEMA_VERSION_V1},
    };

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

    fn agreement() -> AgreementVersionState {
        AgreementVersionState {
            schema_version: SCHEMA_VERSION_V1,
            bump: 1,
            revenue_pool: key(10),
            version: 1,
            predecessor_version: 0,
            status: AgreementStatus::Active,
            settlement_mint: key(4),
            token_program: key(5),
            terms_hash: [11; 32],
            agreement_hash: [12; 32],
            participants: vec![
                ParticipantState {
                    participant_authority: key(20),
                    payout_wallet: key(80),
                    share_units: 50_000_000,
                    payout_revision: 1,
                    cumulative_allocated: 60,
                    cumulative_claimed: 10,
                },
                ParticipantState {
                    participant_authority: key(21),
                    payout_wallet: key(81),
                    share_units: 50_000_000,
                    payout_revision: 1,
                    cumulative_allocated: 40,
                    cumulative_claimed: 5,
                },
            ],
            approval_bitmap: 0b11,
            supersession_approval_bitmap: 0,
            cumulative_gross: 100,
            direct_funding_nonce: 7,
            allocation_sequence: 9,
            created_slot: 1,
            activated_slot: 2,
            superseded_slot: 0,
            reserved: [0; 128],
        }
    }

    #[test]
    fn claim_preparation_is_pure_and_application_only_advances_claimed_state() {
        let cfg = config();
        let mut agreement = agreement();
        let nonce_before = agreement.direct_funding_nonce;
        let sequence_before = agreement.allocation_sequence;
        let gross_before = agreement.cumulative_gross;

        let prepared = prepare_participant_claim(&cfg, &agreement, 0, 100).expect("prepared claim");
        assert_eq!(prepared.amount, 50);
        assert_eq!(prepared.next_claimed, 60);
        assert_eq!(agreement.participants[0].cumulative_claimed, 10);

        apply_prepared_claim(&mut agreement, &prepared).expect("applied claim");
        assert_eq!(agreement.participants[0].cumulative_claimed, 60);
        assert_eq!(agreement.participants[1].cumulative_claimed, 5);
        assert_eq!(agreement.direct_funding_nonce, nonce_before);
        assert_eq!(agreement.allocation_sequence, sequence_before);
        assert_eq!(agreement.cumulative_gross, gross_before);
    }

    #[test]
    fn same_prepared_claim_cannot_be_applied_twice() {
        let cfg = config();
        let mut agreement = agreement();
        let prepared = prepare_participant_claim(&cfg, &agreement, 0, 85).expect("prepared claim");

        apply_prepared_claim(&mut agreement, &prepared).expect("first claim apply");
        assert!(apply_prepared_claim(&mut agreement, &prepared).is_err());
    }

    #[test]
    fn sequential_independent_claims_preserve_solvency() {
        let cfg = config();
        let mut agreement = agreement();
        let mut inbox_balance = 85u64;

        let first = prepare_participant_claim(&cfg, &agreement, 0, inbox_balance)
            .expect("first participant claim");
        inbox_balance = inbox_balance
            .checked_sub(first.amount)
            .expect("first transfer balance");
        apply_prepared_claim(&mut agreement, &first).expect("apply first claim");

        let after_first = inbox_accounting(&agreement, inbox_balance).expect("solvent after first");
        assert_eq!(after_first.allocated_unclaimed, 35);
        assert_eq!(after_first.unallocated, 0);
        assert_eq!(inbox_accounting(&agreement, inbox_balance + 7).unwrap().unallocated, 7);

        let second = prepare_participant_claim(&cfg, &agreement, 1, inbox_balance)
            .expect("second participant claim");
        inbox_balance = inbox_balance
            .checked_sub(second.amount)
            .expect("second transfer balance");
        apply_prepared_claim(&mut agreement, &second).expect("apply second claim");

        let after_second = inbox_accounting(&agreement, inbox_balance).expect("fully settled");
        assert_eq!(after_second.allocated_unclaimed, 0);
        assert_eq!(after_second.unallocated, 0);
        assert_eq!(agreement.participants[0].cumulative_claimed, 60);
        assert_eq!(agreement.participants[1].cumulative_claimed, 40);
    }

    #[test]
    fn claim_pause_is_enforced_independently() {
        let mut cfg = config();
        cfg.claims_paused = true;
        assert!(prepare_participant_claim(&cfg, &agreement(), 0, 100).is_err());
    }

    #[test]
    fn fully_claimed_participant_has_no_claim_instruction() {
        let cfg = config();
        let mut agreement = agreement();
        agreement.participants[0].cumulative_claimed = 60;
        assert!(prepare_participant_claim(&cfg, &agreement, 0, 100).is_err());
    }

    #[test]
    fn uninitialized_payout_route_is_rejected() {
        let cfg = config();
        let mut agreement = agreement();
        agreement.participants[0].payout_wallet = Pubkey::default();
        agreement.participants[0].payout_revision = 0;
        assert!(prepare_participant_claim(&cfg, &agreement, 0, 100).is_err());
    }

    #[test]
    fn payout_rotation_invalidates_a_stale_prepared_claim() {
        let cfg = config();
        let mut agreement = agreement();
        let prepared = prepare_participant_claim(&cfg, &agreement, 0, 100).expect("prepared claim");

        agreement.participants[0].payout_wallet = key(99);
        agreement.participants[0].payout_revision = 2;
        assert!(apply_prepared_claim(&mut agreement, &prepared).is_err());
    }
}
