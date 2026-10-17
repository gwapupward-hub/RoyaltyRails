use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{Mint, Token, TokenAccount},
};

use crate::{
    error::RoyaltyRailError,
    events::RoyaltyInboxInitialized,
    pda::{AGREEMENT_SEED, CONFIG_SEED, VAULT_SEED},
    settlement::{require_canonical_royalty_inbox, require_settleable_agreement},
    state::{AgreementVersionState, ProtocolConfigState},
    ID,
};

pub fn process_initialize_royalty_inbox(ctx: Context<InitializeRoyaltyInbox>) -> Result<()> {
    require_settleable_agreement(&ctx.accounts.config, &ctx.accounts.agreement)?;

    let agreement_key = ctx.accounts.agreement.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    let royalty_inbox = ctx.accounts.royalty_inbox.key();

    require_canonical_royalty_inbox(
        &ID,
        &agreement_key,
        &ctx.accounts.agreement,
        &vault_authority,
        &royalty_inbox,
    )?;

    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.key(),
        associated_token::Create {
            payer: ctx.accounts.payer.to_account_info(),
            associated_token: ctx.accounts.royalty_inbox.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
            mint: ctx.accounts.settlement_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    validate_initialized_royalty_inbox(
        &ctx.accounts.royalty_inbox.to_account_info(),
        ctx.accounts.settlement_mint.key(),
        vault_authority,
        ctx.accounts.token_program.key(),
    )?;

    emit!(RoyaltyInboxInitialized {
        agreement: agreement_key,
        royalty_inbox,
        vault_authority,
        settlement_mint: ctx.accounts.settlement_mint.key(),
        token_program: ctx.accounts.token_program.key(),
        initialized_by: ctx.accounts.payer.key(),
    });

    Ok(())
}

fn validate_initialized_royalty_inbox(
    royalty_inbox: &AccountInfo<'_>,
    expected_mint: Pubkey,
    expected_authority: Pubkey,
    expected_token_program: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *royalty_inbox.owner,
        expected_token_program,
        RoyaltyRailError::InvalidRoyaltyInboxOwner
    );

    let data = royalty_inbox.try_borrow_data()?;
    require!(
        data.len() == TokenAccount::LEN,
        RoyaltyRailError::InvalidRoyaltyInboxData
    );
    let mut data_slice: &[u8] = &data;
    let token_account = TokenAccount::try_deserialize(&mut data_slice)
        .map_err(|_| error!(RoyaltyRailError::InvalidRoyaltyInboxData))?;

    require_keys_eq!(
        token_account.mint,
        expected_mint,
        RoyaltyRailError::InvalidRoyaltyInboxMint
    );
    require_keys_eq!(
        token_account.owner,
        expected_authority,
        RoyaltyRailError::InvalidRoyaltyInboxAuthority
    );

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRoyaltyInbox<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        seeds = [AGREEMENT_SEED, agreement.revenue_pool.as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    #[account(address = config.settlement_mint @ RoyaltyRailError::SettlementConfigMismatch)]
    pub settlement_mint: Account<'info, Mint>,
    /// CHECK: this is the canonical PDA authority [b"vault", agreement]; it intentionally has no state account.
    #[account(seeds = [VAULT_SEED, agreement.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: canonical address and post-CPI SPL Token account fields are validated in the handler.
    #[account(mut)]
    pub royalty_inbox: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(address = config.token_program @ RoyaltyRailError::SettlementConfigMismatch)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
