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
