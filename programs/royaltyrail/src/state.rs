use anchor_lang::prelude::*;

pub const ANCHOR_DISCRIMINATOR_BYTES: usize = 8;
pub const PARTICIPANT_STATE_BYTES: usize = 104;
pub const PROTOCOL_CONFIG_PAYLOAD_BYTES: usize = 238;
pub const WORK_PAYLOAD_BYTES: usize = 247;
pub const REVENUE_POOL_PAYLOAD_BYTES: usize = 249;
pub const AGREEMENT_VERSION_MAX_PAYLOAD_BYTES: usize = 2_028;
pub const AGREEMENT_VERSION_MAX_ACCOUNT_BYTES: usize =
    ANCHOR_DISCRIMINATOR_BYTES + AGREEMENT_VERSION_MAX_PAYLOAD_BYTES;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgreementStatus {
    Proposed,
    Active,
    Superseded,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevenuePoolKind {
    MasterReceipts,
    CompositionReceipts,
    Custom,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettlementBasis {
    OwnershipSplit,
    RevenueParticipation,
    PaymentDirection,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParticipantState {
    pub participant_authority: Pubkey,
    pub payout_wallet: Pubkey,
    pub share_units: u32,
    pub payout_revision: u32,
    pub cumulative_allocated: u128,
    pub cumulative_claimed: u128,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ProtocolConfigState {
    pub schema_version: u16,
    pub bump: u8,
    pub deployment_id: [u8; 32],
    pub governance_authority: Pubkey,
    pub guardian_authority: Pubkey,
    pub settlement_mint: Pubkey,
    pub token_program: Pubkey,
    pub agreements_paused: bool,
    pub allocations_paused: bool,
    pub claims_paused: bool,
    pub created_slot: u64,
    pub reserved: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkState {
    pub schema_version: u16,
    pub bump: u8,
    pub origin_authority: Pubkey,
    pub manager_authority: Pubkey,
    pub pending_manager_authority: Pubkey,
    pub work_id: [u8; 32],
    pub metadata_hash: [u8; 32],
    pub metadata_version: u32,
    pub created_slot: u64,
    pub updated_slot: u64,
    pub reserved: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RevenuePoolState {
    pub schema_version: u16,
    pub bump: u8,
    pub work: Pubkey,
    pub manager_authority: Pubkey,
    pub pending_manager_authority: Pubkey,
    pub pool_id: [u8; 32],
    pub pool_kind: RevenuePoolKind,
    pub settlement_basis: SettlementBasis,
    pub metadata_hash: [u8; 32],
    pub latest_version: u32,
    pub active_version: u32,
    pub pending_version: u32,
    pub created_slot: u64,
    pub reserved: [u8; 64],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AgreementVersionState {
    pub schema_version: u16,
    pub bump: u8,
    pub revenue_pool: Pubkey,
    pub version: u32,
    pub predecessor_version: u32,
    pub status: AgreementStatus,
    pub settlement_mint: Pubkey,
    pub token_program: Pubkey,
    pub terms_hash: [u8; 32],
    pub agreement_hash: [u8; 32],
    pub participants: Vec<ParticipantState>,
    pub approval_bitmap: u16,
    pub supersession_approval_bitmap: u16,
    pub cumulative_gross: u128,
    pub direct_funding_nonce: u64,
    pub allocation_sequence: u64,
    pub created_slot: u64,
    pub activated_slot: u64,
    pub superseded_slot: u64,
    pub reserved: [u8; 128],
}

#[cfg(test)]
mod tests {
    use super::*;

    fn serialized_len<T: AnchorSerialize>(value: &T) -> usize {
        let mut bytes = Vec::new();
        value.serialize(&mut bytes).expect("serialize state");
        bytes.len()
    }

    fn participant(index: u8) -> ParticipantState {
        ParticipantState {
            participant_authority: Pubkey::new_from_array([index; 32]),
            payout_wallet: Pubkey::new_from_array([index.wrapping_add(32); 32]),
            share_units: 6_250_000,
            payout_revision: 1,
            cumulative_allocated: 0,
            cumulative_claimed: 0,
        }
    }

    #[test]
    fn frozen_serialized_sizes_match_specification() {
        assert_eq!(serialized_len(&participant(1)), PARTICIPANT_STATE_BYTES);

        let config = ProtocolConfigState {
            schema_version: 1,
            bump: 255,
            deployment_id: [1; 32],
            governance_authority: Pubkey::new_from_array([2; 32]),
            guardian_authority: Pubkey::new_from_array([3; 32]),
            settlement_mint: Pubkey::new_from_array([4; 32]),
            token_program: Pubkey::new_from_array([5; 32]),
            agreements_paused: false,
            allocations_paused: false,
            claims_paused: false,
            created_slot: 0,
            reserved: [0; 64],
        };
        assert_eq!(serialized_len(&config), PROTOCOL_CONFIG_PAYLOAD_BYTES);

        let work = WorkState {
            schema_version: 1,
            bump: 254,
            origin_authority: Pubkey::new_from_array([6; 32]),
            manager_authority: Pubkey::new_from_array([7; 32]),
            pending_manager_authority: Pubkey::default(),
            work_id: [8; 32],
            metadata_hash: [9; 32],
            metadata_version: 1,
            created_slot: 0,
            updated_slot: 0,
            reserved: [0; 64],
        };
        assert_eq!(serialized_len(&work), WORK_PAYLOAD_BYTES);

        let pool = RevenuePoolState {
            schema_version: 1,
            bump: 253,
            work: Pubkey::new_from_array([10; 32]),
            manager_authority: Pubkey::new_from_array([11; 32]),
            pending_manager_authority: Pubkey::default(),
            pool_id: [12; 32],
            pool_kind: RevenuePoolKind::MasterReceipts,
            settlement_basis: SettlementBasis::RevenueParticipation,
            metadata_hash: [13; 32],
            latest_version: 1,
            active_version: 1,
            pending_version: 0,
            created_slot: 0,
            reserved: [0; 64],
        };
        assert_eq!(serialized_len(&pool), REVENUE_POOL_PAYLOAD_BYTES);

        let agreement = AgreementVersionState {
            schema_version: 1,
            bump: 252,
            revenue_pool: Pubkey::new_from_array([14; 32]),
            version: 1,
            predecessor_version: 0,
            status: AgreementStatus::Active,
            settlement_mint: Pubkey::new_from_array([15; 32]),
            token_program: Pubkey::new_from_array([16; 32]),
            terms_hash: [17; 32],
            agreement_hash: [18; 32],
            participants: (1u8..=16).map(participant).collect(),
            approval_bitmap: u16::MAX,
            supersession_approval_bitmap: 0,
            cumulative_gross: 0,
            direct_funding_nonce: 0,
            allocation_sequence: 0,
            created_slot: 0,
            activated_slot: 0,
            superseded_slot: 0,
            reserved: [0; 128],
        };

        assert_eq!(
            serialized_len(&agreement),
            AGREEMENT_VERSION_MAX_PAYLOAD_BYTES
        );
        assert_eq!(AGREEMENT_VERSION_MAX_ACCOUNT_BYTES, 2_036);
    }
}
