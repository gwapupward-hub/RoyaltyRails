use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod pda;
pub mod state;

use error::RoyaltyRailError;
use events::*;
use pda::{CONFIG_SEED, POOL_SEED, WORK_SEED};
use state::{
    ProtocolConfigState, RevenuePoolKind, RevenuePoolState, SettlementBasis, WorkState,
    PROTOCOL_CONFIG_ACCOUNT_BYTES, REVENUE_POOL_ACCOUNT_BYTES, SCHEMA_VERSION_V1,
    WORK_ACCOUNT_BYTES,
};

// Temporary compile-time development ID. Before local-validator/devnet deployment,
// generate the program keypair and run `anchor keys sync`; never treat this address
// as a production deployment ID.
declare_id!("ErqjTNhQWyLCjJZpFg9jyGAgWJS7KYLN5kFUiNf3KYdH");

const SPL_TOKEN_MINT_BYTES: usize = 82;
const USDC_DECIMALS: u8 = 6;
const ORIGINAL_SPL_TOKEN_PROGRAM_BYTES: [u8; 32] = [
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93, 0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac,
    0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91, 0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9,
];

fn original_spl_token_program_id() -> Pubkey {
    Pubkey::new_from_array(ORIGINAL_SPL_TOKEN_PROGRAM_BYTES)
}

fn require_nonzero_authority(authority: Pubkey) -> Result<()> {
    require!(
        authority != Pubkey::default(),
        RoyaltyRailError::ZeroAuthority
    );
    Ok(())
}

fn require_schema_version(schema_version: u16) -> Result<()> {
    require!(
        schema_version == SCHEMA_VERSION_V1,
        RoyaltyRailError::UnsupportedSchemaVersion
    );
    Ok(())
}

fn validate_settlement_mint(
    settlement_mint: &UncheckedAccount<'_>,
    token_program: &UncheckedAccount<'_>,
) -> Result<()> {
    let token_program_info = token_program.to_account_info();
    require_keys_eq!(
        token_program.key(),
        original_spl_token_program_id(),
        RoyaltyRailError::InvalidTokenProgram
    );
    require!(
        token_program_info.executable,
        RoyaltyRailError::TokenProgramNotExecutable
    );

    let mint_info = settlement_mint.to_account_info();
    require_keys_eq!(
        *mint_info.owner,
        token_program.key(),
        RoyaltyRailError::InvalidSettlementMintOwner
    );
    let mint_data = mint_info.try_borrow_data()?;
    require!(
        mint_data.len() == SPL_TOKEN_MINT_BYTES,
        RoyaltyRailError::InvalidSettlementMintData
    );
    require!(
        mint_data[44] == USDC_DECIMALS,
        RoyaltyRailError::InvalidSettlementMintDecimals
    );
    require!(
        mint_data[45] == 1,
        RoyaltyRailError::SettlementMintNotInitialized
    );
    Ok(())
}

fn require_governance(config: &ProtocolConfigState, authority: Pubkey) -> Result<()> {
    require_schema_version(config.schema_version)?;
    require_keys_eq!(
        authority,
        config.governance_authority,
        RoyaltyRailError::Unauthorized
    );
    Ok(())
}

fn require_work_manager(work: &WorkState, authority: Pubkey) -> Result<()> {
    require_schema_version(work.schema_version)?;
    require_keys_eq!(
        authority,
        work.manager_authority,
        RoyaltyRailError::Unauthorized
    );
    Ok(())
}

fn require_pool_manager(pool: &RevenuePoolState, authority: Pubkey) -> Result<()> {
    require_schema_version(pool.schema_version)?;
    require_keys_eq!(
        authority,
        pool.manager_authority,
        RoyaltyRailError::Unauthorized
    );
    Ok(())
}

#[program]
pub mod royaltyrail {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        deployment_id: [u8; 32],
        guardian_authority: Pubkey,
    ) -> Result<()> {
        require!(
            deployment_id != [0u8; 32],
            RoyaltyRailError::InvalidDeploymentId
        );
        require_nonzero_authority(guardian_authority)?;
        let governance_authority = ctx.accounts.governance_authority.key();
        require_nonzero_authority(governance_authority)?;
        require!(
            guardian_authority != governance_authority,
            RoyaltyRailError::AuthoritiesMustDiffer
        );
        validate_settlement_mint(&ctx.accounts.settlement_mint, &ctx.accounts.token_program)?;

        let slot = Clock::get()?.slot;
        let config_key = ctx.accounts.config.key();
        let config = &mut ctx.accounts.config;
        config.schema_version = SCHEMA_VERSION_V1;
        config.bump = ctx.bumps.config;
        config.deployment_id = deployment_id;
        config.governance_authority = governance_authority;
        config.guardian_authority = guardian_authority;
        config.settlement_mint = ctx.accounts.settlement_mint.key();
        config.token_program = ctx.accounts.token_program.key();
        config.agreements_paused = false;
        config.allocations_paused = false;
        config.claims_paused = false;
        config.created_slot = slot;
        config.reserved = [0; 64];

        emit!(ProtocolInitialized {
            config: config_key,
            governance_authority,
            guardian_authority,
            settlement_mint: config.settlement_mint,
            token_program: config.token_program,
            deployment_id,
        });
        Ok(())
    }

    pub fn guardian_pause(
        ctx: Context<MutateConfig>,
        pause_agreements: bool,
        pause_allocations: bool,
        pause_claims: bool,
    ) -> Result<()> {
        require!(
            pause_agreements || pause_allocations || pause_claims,
            RoyaltyRailError::NoPauseRequested
        );
        let authority = ctx.accounts.authority.key();
        let config = &mut ctx.accounts.config;
        require_schema_version(config.schema_version)?;
        require_keys_eq!(
            authority,
            config.guardian_authority,
            RoyaltyRailError::Unauthorized
        );

        if pause_agreements {
            config.agreements_paused = true;
        }
        if pause_allocations {
            config.allocations_paused = true;
        }
        if pause_claims {
            config.claims_paused = true;
        }

        emit!(PauseFlagsUpdated {
            authority,
            agreements_paused: config.agreements_paused,
            allocations_paused: config.allocations_paused,
            claims_paused: config.claims_paused,
        });
        Ok(())
    }

    pub fn governance_set_pauses(
        ctx: Context<MutateConfig>,
        agreements_paused: bool,
        allocations_paused: bool,
        claims_paused: bool,
    ) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let config = &mut ctx.accounts.config;
        require_governance(config, authority)?;
        config.agreements_paused = agreements_paused;
        config.allocations_paused = allocations_paused;
        config.claims_paused = claims_paused;

        emit!(PauseFlagsUpdated {
            authority,
            agreements_paused,
            allocations_paused,
            claims_paused,
        });
        Ok(())
    }

    pub fn rotate_guardian(ctx: Context<MutateConfig>, new_guardian: Pubkey) -> Result<()> {
        require_nonzero_authority(new_guardian)?;
        let authority = ctx.accounts.authority.key();
        let config = &mut ctx.accounts.config;
        require_governance(config, authority)?;
        require!(
            new_guardian != config.governance_authority,
            RoyaltyRailError::AuthoritiesMustDiffer
        );
        require!(
            new_guardian != config.guardian_authority,
            RoyaltyRailError::GuardianUnchanged
        );

        let previous_guardian = config.guardian_authority;
        config.guardian_authority = new_guardian;
        emit!(GuardianUpdated {
            governance_authority: authority,
            previous_guardian,
            new_guardian,
        });
        Ok(())
    }

    pub fn register_work(
        ctx: Context<RegisterWork>,
        work_id: [u8; 32],
        manager_authority: Pubkey,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        require_nonzero_authority(manager_authority)?;
        let origin_authority = ctx.accounts.origin_authority.key();
        let slot = Clock::get()?.slot;
        let work_key = ctx.accounts.work.key();
        let work = &mut ctx.accounts.work;
        work.schema_version = SCHEMA_VERSION_V1;
        work.bump = ctx.bumps.work;
        work.origin_authority = origin_authority;
        work.manager_authority = manager_authority;
        work.pending_manager_authority = Pubkey::default();
        work.work_id = work_id;
        work.metadata_hash = metadata_hash;
        work.metadata_version = 1;
        work.created_slot = slot;
        work.updated_slot = slot;
        work.reserved = [0; 64];

        emit!(WorkRegistered {
            work: work_key,
            origin_authority,
            manager_authority,
            work_id,
        });
        Ok(())
    }

    pub fn update_work_metadata(ctx: Context<MutateWork>, metadata_hash: [u8; 32]) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let work = &mut ctx.accounts.work;
        require_work_manager(work, authority)?;
        require!(
            work.metadata_hash != metadata_hash,
            RoyaltyRailError::MetadataUnchanged
        );
        work.metadata_version = work
            .metadata_version
            .checked_add(1)
            .ok_or(RoyaltyRailError::MetadataVersionOverflow)?;
        work.metadata_hash = metadata_hash;
        work.updated_slot = Clock::get()?.slot;

        emit!(WorkMetadataUpdated {
            work: work.key(),
            manager_authority: authority,
            metadata_hash,
            metadata_version: work.metadata_version,
        });
        Ok(())
    }

    pub fn propose_work_manager(ctx: Context<MutateWork>, new_manager: Pubkey) -> Result<()> {
        require_nonzero_authority(new_manager)?;
        let authority = ctx.accounts.authority.key();
        let work = &mut ctx.accounts.work;
        require_work_manager(work, authority)?;
        require!(
            new_manager != work.manager_authority,
            RoyaltyRailError::ManagerUnchanged
        );
        require!(
            new_manager != work.pending_manager_authority,
            RoyaltyRailError::ManagerAlreadyPending
        );
        work.pending_manager_authority = new_manager;
        work.updated_slot = Clock::get()?.slot;
        emit!(WorkManagerTransferProposed {
            work: work.key(),
            current_manager: authority,
            pending_manager: new_manager,
        });
        Ok(())
    }

    pub fn accept_work_manager(ctx: Context<MutateWork>) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let work = &mut ctx.accounts.work;
        require_schema_version(work.schema_version)?;
        require!(
            work.pending_manager_authority != Pubkey::default(),
            RoyaltyRailError::NoPendingManager
        );
        require_keys_eq!(
            authority,
            work.pending_manager_authority,
            RoyaltyRailError::PendingManagerMismatch
        );
        let previous_manager = work.manager_authority;
        work.manager_authority = authority;
        work.pending_manager_authority = Pubkey::default();
        work.updated_slot = Clock::get()?.slot;
        emit!(WorkManagerTransferred {
            work: work.key(),
            previous_manager,
            new_manager: authority,
        });
        Ok(())
    }

    pub fn register_revenue_pool(
        ctx: Context<RegisterRevenuePool>,
        pool_id: [u8; 32],
        pool_kind: RevenuePoolKind,
        settlement_basis: SettlementBasis,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        let authority = ctx.accounts.manager.key();
        require_work_manager(&ctx.accounts.work, authority)?;
        let slot = Clock::get()?.slot;
        let pool_key = ctx.accounts.revenue_pool.key();
        let pool = &mut ctx.accounts.revenue_pool;
        pool.schema_version = SCHEMA_VERSION_V1;
        pool.bump = ctx.bumps.revenue_pool;
        pool.work = ctx.accounts.work.key();
        pool.manager_authority = authority;
        pool.pending_manager_authority = Pubkey::default();
        pool.pool_id = pool_id;
        pool.pool_kind = pool_kind;
        pool.settlement_basis = settlement_basis;
        pool.metadata_hash = metadata_hash;
        pool.latest_version = 0;
        pool.active_version = 0;
        pool.pending_version = 0;
        pool.created_slot = slot;
        pool.reserved = [0; 64];

        emit!(RevenuePoolRegistered {
            revenue_pool: pool_key,
            work: pool.work,
            manager_authority: authority,
            pool_id,
        });
        Ok(())
    }

    pub fn propose_pool_manager(
        ctx: Context<MutateRevenuePool>,
        new_manager: Pubkey,
    ) -> Result<()> {
        require_nonzero_authority(new_manager)?;
        let authority = ctx.accounts.authority.key();
        let pool = &mut ctx.accounts.revenue_pool;
        require_pool_manager(pool, authority)?;
        require!(
            new_manager != pool.manager_authority,
            RoyaltyRailError::ManagerUnchanged
        );
        require!(
            new_manager != pool.pending_manager_authority,
            RoyaltyRailError::ManagerAlreadyPending
        );
        pool.pending_manager_authority = new_manager;
        emit!(PoolManagerTransferProposed {
            revenue_pool: pool.key(),
            current_manager: authority,
            pending_manager: new_manager,
        });
        Ok(())
    }

    pub fn accept_pool_manager(ctx: Context<MutateRevenuePool>) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let pool = &mut ctx.accounts.revenue_pool;
        require_schema_version(pool.schema_version)?;
        require!(
            pool.pending_manager_authority != Pubkey::default(),
            RoyaltyRailError::NoPendingManager
        );
        require_keys_eq!(
            authority,
            pool.pending_manager_authority,
            RoyaltyRailError::PendingManagerMismatch
        );
        let previous_manager = pool.manager_authority;
        pool.manager_authority = authority;
        pool.pending_manager_authority = Pubkey::default();
        emit!(PoolManagerTransferred {
            revenue_pool: pool.key(),
            previous_manager,
            new_manager: authority,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = governance_authority,
        space = PROTOCOL_CONFIG_ACCOUNT_BYTES,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    /// CHECK: owner, layout, decimals, and initialized flag are validated by initialize_config.
    pub settlement_mint: UncheckedAccount<'info>,
    /// CHECK: exact program ID and executable status are validated by initialize_config.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(work_id: [u8; 32])]
pub struct RegisterWork<'info> {
    #[account(
        init,
        payer = origin_authority,
        space = WORK_ACCOUNT_BYTES,
        seeds = [WORK_SEED, origin_authority.key().as_ref(), work_id.as_ref()],
        bump
    )]
    pub work: Account<'info, WorkState>,
    #[account(mut)]
    pub origin_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateWork<'info> {
    #[account(
        mut,
        seeds = [WORK_SEED, work.origin_authority.as_ref(), work.work_id.as_ref()],
        bump = work.bump
    )]
    pub work: Account<'info, WorkState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(pool_id: [u8; 32])]
pub struct RegisterRevenuePool<'info> {
    #[account(
        seeds = [WORK_SEED, work.origin_authority.as_ref(), work.work_id.as_ref()],
        bump = work.bump
    )]
    pub work: Account<'info, WorkState>,
    #[account(
        init,
        payer = manager,
        space = REVENUE_POOL_ACCOUNT_BYTES,
        seeds = [POOL_SEED, work.key().as_ref(), pool_id.as_ref()],
        bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(mut)]
    pub manager: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateRevenuePool<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    pub authority: Signer<'info>,
}
