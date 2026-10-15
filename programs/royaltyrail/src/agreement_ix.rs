use anchor_lang::prelude::*;

use crate::{
    error::RoyaltyRailError,
    events::{
        AgreementActivated, AgreementCancelled, AgreementProposed, AgreementRejected,
        AgreementSuperseded, ParticipantApproved, PayoutWalletUpdated, SupersessionApproved,
    },
    lifecycle::{self, AgreementParticipantInput, InitializeProposalParams},
    pda::{AGREEMENT_SEED, CONFIG_SEED, POOL_SEED},
    state::{
        AgreementVersionState, ProtocolConfigState, RevenuePoolState,
        AGREEMENT_VERSION_MAX_ACCOUNT_BYTES, SCHEMA_VERSION_V1,
    },
    ID,
};

fn require_schema_version(schema_version: u16) -> Result<()> {
    require!(
        schema_version == SCHEMA_VERSION_V1,
        RoyaltyRailError::UnsupportedSchemaVersion
    );
    Ok(())
}

fn require_agreements_unpaused(config: &ProtocolConfigState) -> Result<()> {
    require_schema_version(config.schema_version)?;
    require!(
        !config.agreements_paused,
        RoyaltyRailError::AgreementsPaused
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

fn require_agreement_pool(pool_key: Pubkey, agreement: &AgreementVersionState) -> Result<()> {
    require_keys_eq!(
        agreement.revenue_pool,
        pool_key,
        RoyaltyRailError::InvalidAgreementDefinition
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

pub fn process_propose_agreement(
    ctx: Context<ProposeAgreement>,
    version: u32,
    terms_hash: [u8; 32],
    participants: Vec<AgreementParticipantInput>,
) -> Result<()> {
    require_agreements_unpaused(&ctx.accounts.config)?;
    require_pool_manager(&ctx.accounts.revenue_pool, ctx.accounts.manager.key())?;

    let revenue_pool_key = ctx.accounts.revenue_pool.key();
    let agreement_key = ctx.accounts.agreement.key();
    let participant_count =
        u8::try_from(participants.len()).map_err(|_| RoyaltyRailError::InvalidParticipantCount)?;
    let created_slot = Clock::get()?.slot;

    let agreement_hash = lifecycle::initialize_proposal(
        &ctx.accounts.config,
        revenue_pool_key,
        &mut ctx.accounts.revenue_pool,
        &mut ctx.accounts.agreement,
        InitializeProposalParams {
            program_id: ID,
            version,
            terms_hash,
            participant_inputs: &participants,
            bump: ctx.bumps.agreement,
            created_slot,
        },
    )?;

    emit!(AgreementProposed {
        revenue_pool: revenue_pool_key,
        agreement: agreement_key,
        version,
        predecessor_version: ctx.accounts.agreement.predecessor_version,
        agreement_hash,
        participant_count,
    });
    Ok(())
}

pub fn process_approve_agreement(
    ctx: Context<ApproveAgreement>,
    expected_agreement_hash: [u8; 32],
    payout_wallet: Pubkey,
) -> Result<()> {
    require_agreements_unpaused(&ctx.accounts.config)?;
    require_schema_version(ctx.accounts.revenue_pool.schema_version)?;
    require_agreement_pool(ctx.accounts.revenue_pool.key(), &ctx.accounts.agreement)?;
    require_pending(&ctx.accounts.revenue_pool, &ctx.accounts.agreement)?;

    let signer = ctx.accounts.participant.key();
    let agreement_key = ctx.accounts.agreement.key();
    let index = lifecycle::approve_agreement(
        &mut ctx.accounts.agreement,
        signer,
        expected_agreement_hash,
        payout_wallet,
    )?;
    let participant = ctx
        .accounts
        .agreement
        .participants
        .get(index)
        .ok_or(RoyaltyRailError::ParticipantNotFound)?;

    emit!(ParticipantApproved {
        agreement: agreement_key,
        participant_authority: signer,
        participant_index: index as u8,
        payout_wallet: participant.payout_wallet,
        approval_bitmap: ctx.accounts.agreement.approval_bitmap,
    });
    Ok(())
}

pub fn process_approve_supersession(
    ctx: Context<ApproveSupersession>,
    expected_new_hash: [u8; 32],
) -> Result<()> {
    require_agreements_unpaused(&ctx.accounts.config)?;
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.successor)?;
    require_agreement_pool(pool_key, &ctx.accounts.predecessor)?;

    let signer = ctx.accounts.participant.key();
    let successor_key = ctx.accounts.successor.key();
    let predecessor_key = ctx.accounts.predecessor.key();
    let index = lifecycle::approve_supersession(
        &ctx.accounts.revenue_pool,
        &mut ctx.accounts.successor,
        &ctx.accounts.predecessor,
        signer,
        expected_new_hash,
    )?;

    emit!(SupersessionApproved {
        successor: successor_key,
        predecessor: predecessor_key,
        participant_authority: signer,
        predecessor_participant_index: index as u8,
        supersession_approval_bitmap: ctx.accounts.successor.supersession_approval_bitmap,
    });
    Ok(())
}

pub fn process_reject_agreement(ctx: Context<RejectAgreement>) -> Result<()> {
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.agreement)?;
    let signer = ctx.accounts.participant.key();
    let agreement_key = ctx.accounts.agreement.key();
    lifecycle::reject_by_proposed_participant(
        &mut ctx.accounts.revenue_pool,
        &mut ctx.accounts.agreement,
        signer,
    )?;
    emit!(AgreementRejected {
        agreement: agreement_key,
        rejected_by: signer,
        predecessor_participant: false,
    });
    Ok(())
}

pub fn process_reject_replacement(ctx: Context<RejectReplacement>) -> Result<()> {
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.successor)?;
    require_agreement_pool(pool_key, &ctx.accounts.predecessor)?;
    let signer = ctx.accounts.participant.key();
    let agreement_key = ctx.accounts.successor.key();
    lifecycle::reject_by_predecessor_participant(
        &mut ctx.accounts.revenue_pool,
        &mut ctx.accounts.successor,
        &ctx.accounts.predecessor,
        signer,
    )?;
    emit!(AgreementRejected {
        agreement: agreement_key,
        rejected_by: signer,
        predecessor_participant: true,
    });
    Ok(())
}

pub fn process_cancel_agreement(ctx: Context<CancelAgreement>) -> Result<()> {
    require_pool_manager(&ctx.accounts.revenue_pool, ctx.accounts.manager.key())?;
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.agreement)?;
    let agreement_key = ctx.accounts.agreement.key();
    let manager = ctx.accounts.manager.key();
    lifecycle::cancel_proposal(&mut ctx.accounts.revenue_pool, &mut ctx.accounts.agreement)?;
    emit!(AgreementCancelled {
        agreement: agreement_key,
        manager_authority: manager,
    });
    Ok(())
}

pub fn process_activate_initial(ctx: Context<ActivateInitialAgreement>) -> Result<()> {
    require_agreements_unpaused(&ctx.accounts.config)?;
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.agreement)?;
    let agreement_key = ctx.accounts.agreement.key();
    let version = ctx.accounts.agreement.version;
    let predecessor_version = ctx.accounts.agreement.predecessor_version;
    lifecycle::activate_initial(
        &mut ctx.accounts.revenue_pool,
        &mut ctx.accounts.agreement,
        Clock::get()?.slot,
    )?;
    emit!(AgreementActivated {
        agreement: agreement_key,
        revenue_pool: pool_key,
        version,
        predecessor_version,
    });
    Ok(())
}

pub fn process_activate_replacement(ctx: Context<ActivateReplacementAgreement>) -> Result<()> {
    require_agreements_unpaused(&ctx.accounts.config)?;
    let pool_key = ctx.accounts.revenue_pool.key();
    require_agreement_pool(pool_key, &ctx.accounts.successor)?;
    require_agreement_pool(pool_key, &ctx.accounts.predecessor)?;

    let successor_key = ctx.accounts.successor.key();
    let predecessor_key = ctx.accounts.predecessor.key();
    let successor_version = ctx.accounts.successor.version;
    let predecessor_version = ctx.accounts.predecessor.version;

    lifecycle::activate_replacement(
        &mut ctx.accounts.revenue_pool,
        &mut ctx.accounts.successor,
        &mut ctx.accounts.predecessor,
        Clock::get()?.slot,
    )?;

    emit!(AgreementSuperseded {
        agreement: predecessor_key,
        revenue_pool: pool_key,
        version: predecessor_version,
        successor_version,
    });
    emit!(AgreementActivated {
        agreement: successor_key,
        revenue_pool: pool_key,
        version: successor_version,
        predecessor_version,
    });
    Ok(())
}

pub fn process_update_payout_wallet(
    ctx: Context<UpdatePayoutWallet>,
    new_wallet: Pubkey,
) -> Result<()> {
    let signer = ctx.accounts.participant.key();
    let agreement_key = ctx.accounts.agreement.key();
    let update = lifecycle::update_payout_wallet(&mut ctx.accounts.agreement, signer, new_wallet)?;

    emit!(PayoutWalletUpdated {
        agreement: agreement_key,
        participant_authority: signer,
        participant_index: update.participant_index as u8,
        previous_wallet: update.previous_wallet,
        new_wallet,
        payout_revision: update.new_revision,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(version: u32)]
pub struct ProposeAgreement<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        init,
        payer = manager,
        space = AGREEMENT_VERSION_MAX_ACCOUNT_BYTES,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &version.to_le_bytes()],
        bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    #[account(mut)]
    pub manager: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveAgreement<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump,
        constraint = agreement.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveSupersession<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &successor.version.to_le_bytes()],
        bump = successor.bump,
        constraint = successor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub successor: Account<'info, AgreementVersionState>,
    #[account(
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &predecessor.version.to_le_bytes()],
        bump = predecessor.bump,
        constraint = predecessor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub predecessor: Account<'info, AgreementVersionState>,
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct RejectAgreement<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump,
        constraint = agreement.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct RejectReplacement<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &successor.version.to_le_bytes()],
        bump = successor.bump,
        constraint = successor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub successor: Account<'info, AgreementVersionState>,
    #[account(
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &predecessor.version.to_le_bytes()],
        bump = predecessor.bump,
        constraint = predecessor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub predecessor: Account<'info, AgreementVersionState>,
    pub participant: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelAgreement<'info> {
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump,
        constraint = agreement.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    pub manager: Signer<'info>,
}

#[derive(Accounts)]
pub struct ActivateInitialAgreement<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump,
        constraint = agreement.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub agreement: Account<'info, AgreementVersionState>,
}

#[derive(Accounts)]
pub struct ActivateReplacementAgreement<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [POOL_SEED, revenue_pool.work.as_ref(), revenue_pool.pool_id.as_ref()],
        bump = revenue_pool.bump
    )]
    pub revenue_pool: Account<'info, RevenuePoolState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &successor.version.to_le_bytes()],
        bump = successor.bump,
        constraint = successor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub successor: Account<'info, AgreementVersionState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, revenue_pool.key().as_ref(), &predecessor.version.to_le_bytes()],
        bump = predecessor.bump,
        constraint = predecessor.revenue_pool == revenue_pool.key() @ RoyaltyRailError::InvalidAgreementDefinition
    )]
    pub predecessor: Account<'info, AgreementVersionState>,
}

#[derive(Accounts)]
pub struct UpdatePayoutWallet<'info> {
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, agreement.revenue_pool.as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    pub participant: Signer<'info>,
}
