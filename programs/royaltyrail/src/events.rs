use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub config: Pubkey,
    pub governance_authority: Pubkey,
    pub guardian_authority: Pubkey,
    pub settlement_mint: Pubkey,
    pub token_program: Pubkey,
    pub deployment_id: [u8; 32],
}

#[event]
pub struct PauseFlagsUpdated {
    pub authority: Pubkey,
    pub agreements_paused: bool,
    pub allocations_paused: bool,
    pub claims_paused: bool,
}

#[event]
pub struct GuardianUpdated {
    pub governance_authority: Pubkey,
    pub previous_guardian: Pubkey,
    pub new_guardian: Pubkey,
}

#[event]
pub struct WorkRegistered {
    pub work: Pubkey,
    pub origin_authority: Pubkey,
    pub manager_authority: Pubkey,
    pub work_id: [u8; 32],
}

#[event]
pub struct WorkMetadataUpdated {
    pub work: Pubkey,
    pub manager_authority: Pubkey,
    pub metadata_hash: [u8; 32],
    pub metadata_version: u32,
}

#[event]
pub struct WorkManagerTransferProposed {
    pub work: Pubkey,
    pub current_manager: Pubkey,
    pub pending_manager: Pubkey,
}

#[event]
pub struct WorkManagerTransferred {
    pub work: Pubkey,
    pub previous_manager: Pubkey,
    pub new_manager: Pubkey,
}

#[event]
pub struct RevenuePoolRegistered {
    pub revenue_pool: Pubkey,
    pub work: Pubkey,
    pub manager_authority: Pubkey,
    pub pool_id: [u8; 32],
}

#[event]
pub struct PoolManagerTransferProposed {
    pub revenue_pool: Pubkey,
    pub current_manager: Pubkey,
    pub pending_manager: Pubkey,
}

#[event]
pub struct PoolManagerTransferred {
    pub revenue_pool: Pubkey,
    pub previous_manager: Pubkey,
    pub new_manager: Pubkey,
}

#[event]
pub struct AgreementProposed {
    pub revenue_pool: Pubkey,
    pub agreement: Pubkey,
    pub version: u32,
    pub predecessor_version: u32,
    pub agreement_hash: [u8; 32],
    pub participant_count: u8,
}

#[event]
pub struct ParticipantApproved {
    pub agreement: Pubkey,
    pub participant_authority: Pubkey,
    pub participant_index: u8,
    pub payout_wallet: Pubkey,
    pub approval_bitmap: u16,
}

#[event]
pub struct SupersessionApproved {
    pub successor: Pubkey,
    pub predecessor: Pubkey,
    pub participant_authority: Pubkey,
    pub predecessor_participant_index: u8,
    pub supersession_approval_bitmap: u16,
}

#[event]
pub struct AgreementRejected {
    pub agreement: Pubkey,
    pub rejected_by: Pubkey,
    pub predecessor_participant: bool,
}

#[event]
pub struct AgreementCancelled {
    pub agreement: Pubkey,
    pub manager_authority: Pubkey,
}

#[event]
pub struct AgreementActivated {
    pub agreement: Pubkey,
    pub revenue_pool: Pubkey,
    pub version: u32,
    pub predecessor_version: u32,
}

#[event]
pub struct AgreementSuperseded {
    pub agreement: Pubkey,
    pub revenue_pool: Pubkey,
    pub version: u32,
    pub successor_version: u32,
}

#[event]
pub struct PayoutWalletUpdated {
    pub agreement: Pubkey,
    pub participant_authority: Pubkey,
    pub participant_index: u8,
    pub previous_wallet: Pubkey,
    pub new_wallet: Pubkey,
    pub payout_revision: u32,
}

#[event]
pub struct RoyaltyInboxInitialized {
    pub agreement: Pubkey,
    pub royalty_inbox: Pubkey,
    pub vault_authority: Pubkey,
    pub settlement_mint: Pubkey,
    pub token_program: Pubkey,
    pub initialized_by: Pubkey,
}
