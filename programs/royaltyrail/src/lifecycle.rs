use anchor_lang::prelude::*;
use royaltyrail_core::{
    agreement_hash_v1, validate_participants, AgreementHashInputV1, CoreError,
    Participant as CoreParticipant, RevenuePoolKind as CoreRevenuePoolKind,
    SettlementBasis as CoreSettlementBasis, MAX_PARTICIPANTS, MIN_PARTICIPANTS,
};

use crate::{
    error::RoyaltyRailError,
    state::{
        AgreementStatus, AgreementVersionState, ParticipantState, ProtocolConfigState,
        RevenuePoolKind, RevenuePoolState, SettlementBasis, SCHEMA_VERSION_V1,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AgreementParticipantInput {
    pub participant_authority: Pubkey,
    pub share_units: u32,
}

fn protocol_error(error: CoreError) -> Error {
    match error {
        CoreError::ParticipantCount => error!(RoyaltyRailError::InvalidParticipantCount),
        CoreError::ZeroAuthority => error!(RoyaltyRailError::InvalidParticipantAuthority),
        CoreError::NonCanonicalAuthorityOrder => error!(RoyaltyRailError::NonCanonicalParticipants),
        CoreError::InvalidShare => error!(RoyaltyRailError::InvalidShare),
        CoreError::InvalidShareTotal => error!(RoyaltyRailError::InvalidShareTotal),
        CoreError::ArithmeticOverflow => error!(RoyaltyRailError::ArithmeticOverflow),
        _ => error!(RoyaltyRailError::InvalidAgreementDefinition),
    }
}

fn require_schema_version(schema_version: u16) -> Result<()> {
    require!(
        schema_version == SCHEMA_VERSION_V1,
        RoyaltyRailError::UnsupportedSchemaVersion
    );
    Ok(())
}

fn core_pool_kind(value: RevenuePoolKind) -> CoreRevenuePoolKind {
    match value {
        RevenuePoolKind::MasterReceipts => CoreRevenuePoolKind::MasterReceipts,
        RevenuePoolKind::CompositionReceipts => CoreRevenuePoolKind::CompositionReceipts,
        RevenuePoolKind::Custom => CoreRevenuePoolKind::Custom,
    }
}

fn core_settlement_basis(value: SettlementBasis) -> CoreSettlementBasis {
    match value {
        SettlementBasis::OwnershipSplit => CoreSettlementBasis::OwnershipSplit,
        SettlementBasis::RevenueParticipation => CoreSettlementBasis::RevenueParticipation,
        SettlementBasis::PaymentDirection => CoreSettlementBasis::PaymentDirection,
    }
}

fn core_participants(inputs: &[AgreementParticipantInput]) -> Result<Vec<CoreParticipant>> {
    let participants: Vec<CoreParticipant> = inputs
        .iter()
        .map(|participant| CoreParticipant {
            authority: participant.participant_authority.to_bytes(),
            share_units: participant.share_units,
        })
        .collect();

    validate_participants(&participants).map_err(protocol_error)?;
    Ok(participants)
}

fn participant_states(inputs: &[AgreementParticipantInput]) -> Vec<ParticipantState> {
    inputs
        .iter()
        .map(|participant| ParticipantState {
            participant_authority: participant.participant_authority,
            payout_wallet: Pubkey::default(),
            share_units: participant.share_units,
            payout_revision: 0,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        })
        .collect()
}

pub fn required_mask(participant_count: usize) -> Result<u16> {
    require!(
        (MIN_PARTICIPANTS..=MAX_PARTICIPANTS).contains(&participant_count),
        RoyaltyRailError::InvalidParticipantCount
    );

    if participant_count == MAX_PARTICIPANTS {
        Ok(u16::MAX)
    } else {
        Ok((1u16 << participant_count) - 1)
    }
}

fn approval_bit(index: usize) -> Result<u16> {
    require!(
        index < MAX_PARTICIPANTS,
        RoyaltyRailError::InvalidParticipantCount
    );
    Ok(1u16 << index)
}

fn participant_index(participants: &[ParticipantState], authority: Pubkey) -> Result<usize> {
    participants
        .iter()
        .position(|participant| participant.participant_authority == authority)
        .ok_or_else(|| error!(RoyaltyRailError::ParticipantNotFound))
}

fn require_proposed(agreement: &AgreementVersionState) -> Result<()> {
    require!(
        agreement.status == AgreementStatus::Proposed,
        RoyaltyRailError::AgreementNotProposed
    );
    Ok(())
}

fn require_pending(pool: &RevenuePoolState, agreement: &AgreementVersionState) -> Result<()> {
    require!(
        pool.pending_version == agreement.version,
        RoyaltyRailError::PendingAgreementMismatch
    );
    Ok(())
}

fn all_payout_routes_initialized(agreement: &AgreementVersionState) -> bool {
    agreement.participants.iter().all(|participant| {
        participant.payout_wallet != Pubkey::default() && participant.payout_revision > 0
    })
}

pub fn initialize_proposal(
    config: &ProtocolConfigState,
    revenue_pool_key: Pubkey,
    pool: &mut RevenuePoolState,
    agreement: &mut AgreementVersionState,
    program_id: Pubkey,
    version: u32,
    terms_hash: [u8; 32],
    participant_inputs: &[AgreementParticipantInput],
    bump: u8,
    created_slot: u64,
) -> Result<[u8; 32]> {
    require_schema_version(config.schema_version)?;
    require_schema_version(pool.schema_version)?;
    require!(
        pool.pending_version == 0,
        RoyaltyRailError::PendingAgreementExists
    );
    require!(
        pool.active_version <= pool.latest_version,
        RoyaltyRailError::InvalidPoolVersionState
    );

    let expected_version = pool
        .latest_version
        .checked_add(1)
        .ok_or(RoyaltyRailError::AgreementVersionOverflow)?;
    require!(
        version == expected_version,
        RoyaltyRailError::UnexpectedAgreementVersion
    );

    let predecessor_version = pool.active_version;
    let participants = core_participants(participant_inputs)?;
    let agreement_hash = agreement_hash_v1(&AgreementHashInputV1 {
        deployment_id: config.deployment_id,
        program_id: program_id.to_bytes(),
        revenue_pool: revenue_pool_key.to_bytes(),
        version,
        predecessor_version,
        settlement_mint: config.settlement_mint.to_bytes(),
        token_program: config.token_program.to_bytes(),
        pool_kind: core_pool_kind(pool.pool_kind),
        settlement_basis: core_settlement_basis(pool.settlement_basis),
        pool_metadata_hash: pool.metadata_hash,
        terms_hash,
        participants: &participants,
    })
    .map_err(protocol_error)?;

    agreement.schema_version = SCHEMA_VERSION_V1;
    agreement.bump = bump;
    agreement.revenue_pool = revenue_pool_key;
    agreement.version = version;
    agreement.predecessor_version = predecessor_version;
    agreement.status = AgreementStatus::Proposed;
    agreement.settlement_mint = config.settlement_mint;
    agreement.token_program = config.token_program;
    agreement.terms_hash = terms_hash;
    agreement.agreement_hash = agreement_hash;
    agreement.participants = participant_states(participant_inputs);
    agreement.approval_bitmap = 0;
    agreement.supersession_approval_bitmap = 0;
    agreement.cumulative_gross = 0;
    agreement.direct_funding_nonce = 0;
    agreement.allocation_sequence = 0;
    agreement.created_slot = created_slot;
    agreement.activated_slot = 0;
    agreement.superseded_slot = 0;
    agreement.reserved = [0; 128];

    pool.latest_version = version;
    pool.pending_version = version;

    Ok(agreement_hash)
}

pub fn approve_agreement(
    agreement: &mut AgreementVersionState,
    signer: Pubkey,
    expected_agreement_hash: [u8; 32],
    payout_wallet: Pubkey,
) -> Result<usize> {
    require_schema_version(agreement.schema_version)?;
    require_proposed(agreement)?;
    require!(
        expected_agreement_hash == agreement.agreement_hash,
        RoyaltyRailError::AgreementHashMismatch
    );
    require!(
        payout_wallet != Pubkey::default(),
        RoyaltyRailError::InvalidPayoutWallet
    );

    let index = participant_index(&agreement.participants, signer)?;
    let bit = approval_bit(index)?;
    require!(
        agreement.approval_bitmap & bit == 0,
        RoyaltyRailError::DuplicateApproval
    );

    let participant = agreement
        .participants
        .get_mut(index)
        .ok_or(RoyaltyRailError::ParticipantNotFound)?;
    require!(
        participant.payout_wallet == Pubkey::default() && participant.payout_revision == 0,
        RoyaltyRailError::InvalidPayoutRevision
    );

    participant.payout_wallet = payout_wallet;
    participant.payout_revision = 1;
    agreement.approval_bitmap |= bit;
    Ok(index)
}

pub fn approve_supersession(
    pool: &RevenuePoolState,
    successor: &mut AgreementVersionState,
    predecessor: &AgreementVersionState,
    signer: Pubkey,
    expected_new_hash: [u8; 32],
) -> Result<usize> {
    require_schema_version(pool.schema_version)?;
    require_schema_version(successor.schema_version)?;
    require_schema_version(predecessor.schema_version)?;
    require_proposed(successor)?;
    require!(
        predecessor.status == AgreementStatus::Active,
        RoyaltyRailError::AgreementNotActive
    );
    require!(
        successor.predecessor_version != 0 && successor.predecessor_version == predecessor.version,
        RoyaltyRailError::InvalidPredecessor
    );
    require!(
        pool.active_version == predecessor.version,
        RoyaltyRailError::ActiveAgreementMismatch
    );
    require_pending(pool, successor)?;
    require!(
        expected_new_hash == successor.agreement_hash,
        RoyaltyRailError::AgreementHashMismatch
    );

    let index = participant_index(&predecessor.participants, signer)?;
    let bit = approval_bit(index)?;
    require!(
        successor.supersession_approval_bitmap & bit == 0,
        RoyaltyRailError::DuplicateApproval
    );
    successor.supersession_approval_bitmap |= bit;
    Ok(index)
}

pub fn cancel_proposal(
    pool: &mut RevenuePoolState,
    agreement: &mut AgreementVersionState,
) -> Result<()> {
    require_schema_version(pool.schema_version)?;
    require_schema_version(agreement.schema_version)?;
    require_proposed(agreement)?;
    require_pending(pool, agreement)?;

    agreement.status = AgreementStatus::Cancelled;
    pool.pending_version = 0;
    Ok(())
}

pub fn reject_by_proposed_participant(
    pool: &mut RevenuePoolState,
    agreement: &mut AgreementVersionState,
    signer: Pubkey,
) -> Result<usize> {
    let index = participant_index(&agreement.participants, signer)?;
    cancel_proposal(pool, agreement)?;
    Ok(index)
}

pub fn reject_by_predecessor_participant(
    pool: &mut RevenuePoolState,
    successor: &mut AgreementVersionState,
    predecessor: &AgreementVersionState,
    signer: Pubkey,
) -> Result<usize> {
    require!(
        successor.predecessor_version != 0 && successor.predecessor_version == predecessor.version,
        RoyaltyRailError::InvalidPredecessor
    );
    require!(
        predecessor.status == AgreementStatus::Active,
        RoyaltyRailError::AgreementNotActive
    );
    require!(
        pool.active_version == predecessor.version,
        RoyaltyRailError::ActiveAgreementMismatch
    );
    let index = participant_index(&predecessor.participants, signer)?;
    cancel_proposal(pool, successor)?;
    Ok(index)
}

pub fn activate_initial(
    pool: &mut RevenuePoolState,
    agreement: &mut AgreementVersionState,
    slot: u64,
) -> Result<()> {
    require_schema_version(pool.schema_version)?;
    require_schema_version(agreement.schema_version)?;
    require_proposed(agreement)?;
    require_pending(pool, agreement)?;
    require!(
        agreement.predecessor_version == 0 && pool.active_version == 0,
        RoyaltyRailError::InitialActivationConflict
    );

    let required = required_mask(agreement.participants.len())?;
    require!(
        agreement.approval_bitmap == required,
        RoyaltyRailError::ApprovalIncomplete
    );
    require!(
        all_payout_routes_initialized(agreement),
        RoyaltyRailError::PayoutRouteUninitialized
    );

    agreement.status = AgreementStatus::Active;
    agreement.activated_slot = slot;
    pool.active_version = agreement.version;
    pool.pending_version = 0;
    Ok(())
}

pub fn activate_replacement(
    pool: &mut RevenuePoolState,
    successor: &mut AgreementVersionState,
    predecessor: &mut AgreementVersionState,
    slot: u64,
) -> Result<()> {
    require_schema_version(pool.schema_version)?;
    require_schema_version(successor.schema_version)?;
    require_schema_version(predecessor.schema_version)?;
    require_proposed(successor)?;
    require!(
        predecessor.status == AgreementStatus::Active,
        RoyaltyRailError::AgreementNotActive
    );
    require!(
        successor.predecessor_version != 0 && successor.predecessor_version == predecessor.version,
        RoyaltyRailError::InvalidPredecessor
    );
    require!(
        pool.active_version == predecessor.version,
        RoyaltyRailError::ActiveAgreementMismatch
    );
    require_pending(pool, successor)?;

    let successor_required = required_mask(successor.participants.len())?;
    require!(
        successor.approval_bitmap == successor_required,
        RoyaltyRailError::ApprovalIncomplete
    );
    require!(
        all_payout_routes_initialized(successor),
        RoyaltyRailError::PayoutRouteUninitialized
    );

    let predecessor_required = required_mask(predecessor.participants.len())?;
    require!(
        successor.supersession_approval_bitmap == predecessor_required,
        RoyaltyRailError::SupersessionConsentIncomplete
    );

    predecessor.status = AgreementStatus::Superseded;
    predecessor.superseded_slot = slot;
    successor.status = AgreementStatus::Active;
    successor.activated_slot = slot;
    pool.active_version = successor.version;
    pool.pending_version = 0;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayoutWalletUpdate {
    pub participant_index: usize,
    pub previous_wallet: Pubkey,
    pub new_revision: u32,
}

pub fn update_payout_wallet(
    agreement: &mut AgreementVersionState,
    signer: Pubkey,
    new_wallet: Pubkey,
) -> Result<PayoutWalletUpdate> {
    require_schema_version(agreement.schema_version)?;
    require!(
        matches!(
            agreement.status,
            AgreementStatus::Proposed | AgreementStatus::Active | AgreementStatus::Superseded
        ),
        RoyaltyRailError::PayoutRotationUnavailable
    );
    require!(
        new_wallet != Pubkey::default(),
        RoyaltyRailError::InvalidPayoutWallet
    );

    let index = participant_index(&agreement.participants, signer)?;
    let bit = approval_bit(index)?;
    if agreement.status == AgreementStatus::Proposed {
        require!(
            agreement.approval_bitmap & bit != 0,
            RoyaltyRailError::ParticipantNotApproved
        );
    }

    let participant = agreement
        .participants
        .get_mut(index)
        .ok_or(RoyaltyRailError::ParticipantNotFound)?;
    require!(
        participant.payout_revision > 0 && participant.payout_wallet != Pubkey::default(),
        RoyaltyRailError::PayoutRouteUninitialized
    );
    require!(
        participant.payout_wallet != new_wallet,
        RoyaltyRailError::PayoutWalletUnchanged
    );

    let previous_wallet = participant.payout_wallet;
    participant.payout_revision = participant
        .payout_revision
        .checked_add(1)
        .ok_or(RoyaltyRailError::PayoutRevisionOverflow)?;
    participant.payout_wallet = new_wallet;

    Ok(PayoutWalletUpdate {
        participant_index: index,
        previous_wallet,
        new_revision: participant.payout_revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{RevenuePoolKind, SettlementBasis, AGREEMENT_VERSION_MAX_ACCOUNT_BYTES};

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
    }

    fn participant(authority: u8, share_units: u32) -> ParticipantState {
        ParticipantState {
            participant_authority: key(authority),
            payout_wallet: key(authority.wrapping_add(100)),
            share_units,
            payout_revision: 1,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }
    }

    fn agreement(
        version: u32,
        predecessor_version: u32,
        status: AgreementStatus,
        participants: Vec<ParticipantState>,
    ) -> AgreementVersionState {
        AgreementVersionState {
            schema_version: SCHEMA_VERSION_V1,
            bump: 1,
            revenue_pool: key(20),
            version,
            predecessor_version,
            status,
            settlement_mint: key(21),
            token_program: key(22),
            terms_hash: [23; 32],
            agreement_hash: [24u8.wrapping_add(version as u8); 32],
            participants,
            approval_bitmap: 0,
            supersession_approval_bitmap: 0,
            cumulative_gross: 0,
            direct_funding_nonce: 0,
            allocation_sequence: 0,
            created_slot: 1,
            activated_slot: 0,
            superseded_slot: 0,
            reserved: [0; 128],
        }
    }

    fn pool() -> RevenuePoolState {
        RevenuePoolState {
            schema_version: SCHEMA_VERSION_V1,
            bump: 1,
            work: key(10),
            manager_authority: key(11),
            pending_manager_authority: Pubkey::default(),
            pool_id: [12; 32],
            pool_kind: RevenuePoolKind::MasterReceipts,
            settlement_basis: SettlementBasis::RevenueParticipation,
            metadata_hash: [13; 32],
            latest_version: 0,
            active_version: 0,
            pending_version: 0,
            created_slot: 1,
            reserved: [0; 64],
        }
    }

    #[test]
    fn required_masks_cover_one_and_sixteen_participants() {
        assert_eq!(required_mask(1).expect("one"), 0b1);
        assert_eq!(required_mask(16).expect("sixteen"), u16::MAX);
        assert!(required_mask(0).is_err());
        assert!(required_mask(17).is_err());
    }

    #[test]
    fn proposal_uses_frozen_hash_and_zeroes_mutable_economic_state() {
        let config = ProtocolConfigState {
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
        };
        let mut pool = pool();
        let mut proposal = agreement(0, 0, AgreementStatus::Cancelled, Vec::new());
        let inputs = vec![
            AgreementParticipantInput {
                participant_authority: key(30),
                share_units: 60_000_000,
            },
            AgreementParticipantInput {
                participant_authority: key(31),
                share_units: 40_000_000,
            },
        ];

        let hash = initialize_proposal(
            &config,
            key(20),
            &mut pool,
            &mut proposal,
            key(6),
            1,
            [7; 32],
            &inputs,
            250,
            99,
        )
        .expect("proposal");

        assert_eq!(proposal.agreement_hash, hash);
        assert_eq!(proposal.status, AgreementStatus::Proposed);
        assert_eq!(proposal.participants.len(), 2);
        assert!(proposal
            .participants
            .iter()
            .all(|p| p.payout_revision == 0));
        assert!(proposal
            .participants
            .iter()
            .all(|p| p.payout_wallet == Pubkey::default()));
        assert_eq!(pool.latest_version, 1);
        assert_eq!(pool.pending_version, 1);
        assert_eq!(AGREEMENT_VERSION_MAX_ACCOUNT_BYTES, 2_036);
    }

    #[test]
    fn replacement_cannot_remove_bob_without_bobs_supersession_consent() {
        let alice = key(30);
        let bob = key(31);
        let mut pool = pool();
        pool.latest_version = 2;
        pool.active_version = 1;
        pool.pending_version = 2;

        let mut predecessor = agreement(
            1,
            0,
            AgreementStatus::Active,
            vec![participant(30, 60_000_000), participant(31, 40_000_000)],
        );
        let mut successor = agreement(
            2,
            1,
            AgreementStatus::Proposed,
            vec![ParticipantState {
                participant_authority: alice,
                payout_wallet: Pubkey::default(),
                share_units: 100_000_000,
                payout_revision: 0,
                cumulative_allocated: 0,
                cumulative_claimed: 0,
            }],
        );
        let successor_hash = successor.agreement_hash;

        approve_agreement(&mut successor, alice, successor_hash, key(130))
            .expect("Alice approves successor");
        assert!(activate_replacement(&mut pool, &mut successor, &mut predecessor, 10).is_err());

        approve_supersession(&pool, &mut successor, &predecessor, alice, successor_hash)
            .expect("Alice approves supersession");
        assert!(activate_replacement(&mut pool, &mut successor, &mut predecessor, 11).is_err());
        assert_eq!(predecessor.status, AgreementStatus::Active);
        assert_eq!(successor.status, AgreementStatus::Proposed);

        approve_supersession(&pool, &mut successor, &predecessor, bob, successor_hash)
            .expect("Bob approves supersession");
        activate_replacement(&mut pool, &mut successor, &mut predecessor, 12)
            .expect("replacement activation");

        assert_eq!(predecessor.status, AgreementStatus::Superseded);
        assert_eq!(predecessor.superseded_slot, 12);
        assert_eq!(successor.status, AgreementStatus::Active);
        assert_eq!(successor.activated_slot, 12);
        assert_eq!(pool.active_version, 2);
        assert_eq!(pool.pending_version, 0);
    }

    #[test]
    fn cancelled_proposal_is_terminal_for_approval_and_activation() {
        let alice = key(30);
        let mut pool = pool();
        pool.latest_version = 1;
        pool.pending_version = 1;
        let mut proposal = agreement(
            1,
            0,
            AgreementStatus::Proposed,
            vec![ParticipantState {
                participant_authority: alice,
                payout_wallet: Pubkey::default(),
                share_units: 100_000_000,
                payout_revision: 0,
                cumulative_allocated: 0,
                cumulative_claimed: 0,
            }],
        );
        let hash = proposal.agreement_hash;

        reject_by_proposed_participant(&mut pool, &mut proposal, alice).expect("reject");
        assert_eq!(proposal.status, AgreementStatus::Cancelled);
        assert_eq!(pool.pending_version, 0);
        assert!(approve_agreement(&mut proposal, alice, hash, key(130)).is_err());
        assert!(activate_initial(&mut pool, &mut proposal, 9).is_err());
    }

    #[test]
    fn payout_rotation_is_participant_only_and_requires_proposed_approval() {
        let alice = key(30);
        let bob = key(31);
        let mut proposal = agreement(
            1,
            0,
            AgreementStatus::Proposed,
            vec![ParticipantState {
                participant_authority: alice,
                payout_wallet: Pubkey::default(),
                share_units: 100_000_000,
                payout_revision: 0,
                cumulative_allocated: 0,
                cumulative_claimed: 0,
            }],
        );
        let hash = proposal.agreement_hash;

        assert!(update_payout_wallet(&mut proposal, alice, key(140)).is_err());
        assert!(approve_agreement(&mut proposal, bob, hash, key(141)).is_err());
        approve_agreement(&mut proposal, alice, hash, key(130)).expect("approve");

        let update = update_payout_wallet(&mut proposal, alice, key(140)).expect("rotate");
        assert_eq!(update.participant_index, 0);
        assert_eq!(update.previous_wallet, key(130));
        assert_eq!(update.new_revision, 2);
        assert_eq!(proposal.participants[0].payout_wallet, key(140));

        proposal.status = AgreementStatus::Cancelled;
        assert!(update_payout_wallet(&mut proposal, alice, key(150)).is_err());
    }
}
