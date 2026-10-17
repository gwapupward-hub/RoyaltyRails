use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken},
    token::{self, Mint, Token, TokenAccount},
};
use royaltyrail_core::AllocationMode;

use crate::{
    claims::{apply_prepared_claim, prepare_participant_claim},
    error::RoyaltyRailError,
    events::{PayoutClaimed, RevenueAllocated, RoyaltyInboxInitialized},
    pda::{associated_token_program_id, AGREEMENT_SEED, CONFIG_SEED, VAULT_SEED},
    settlement::{
        apply_prepared_allocation, inbox_accounting, next_direct_funding_nonce,
        prepare_revenue_allocation, require_canonical_royalty_inbox, require_settleable_agreement,
    },
    state::{AgreementVersionState, ProtocolConfigState},
    ID, USDC_DECIMALS,
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

pub fn process_fund_and_allocate(
    ctx: Context<FundAndAllocate>,
    amount: u64,
    expected_nonce: u64,
    payment_reference: [u8; 32],
) -> Result<()> {
    require_settleable_agreement(&ctx.accounts.config, &ctx.accounts.agreement)?;
    require!(
        ctx.accounts.settlement_mint.decimals == USDC_DECIMALS,
        RoyaltyRailError::InvalidSettlementMintDecimals
    );

    let agreement_key = ctx.accounts.agreement.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    validate_existing_royalty_inbox(
        agreement_key,
        &ctx.accounts.agreement,
        vault_authority,
        ctx.accounts.royalty_inbox.key(),
        &ctx.accounts.royalty_inbox,
    )?;
    inbox_accounting(&ctx.accounts.agreement, ctx.accounts.royalty_inbox.amount)?;

    validate_payer_source_fields(
        ctx.accounts.payer_source.mint,
        ctx.accounts.payer_source.owner,
        ctx.accounts.agreement.settlement_mint,
        ctx.accounts.payer.key(),
    )?;

    let next_nonce = next_direct_funding_nonce(&ctx.accounts.agreement, expected_nonce)?;
    let prepared = prepare_revenue_allocation(
        &ctx.accounts.config,
        &agreement_key,
        &ctx.accounts.agreement,
        amount,
        AllocationMode::DirectFunding,
        payment_reference,
    )?;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::TransferChecked {
                from: ctx.accounts.payer_source.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.royalty_inbox.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.settlement_mint.decimals,
    )?;

    apply_prepared_allocation(&mut ctx.accounts.agreement, &prepared)?;
    ctx.accounts.agreement.direct_funding_nonce = next_nonce;

    emit!(RevenueAllocated {
        agreement: agreement_key,
        allocation_sequence: prepared.next_sequence,
        mode: AllocationMode::DirectFunding as u8,
        gross_amount: prepared.gross_amount,
        payment_reference,
        allocation_commitment: prepared.commitment,
    });

    Ok(())
}

pub fn process_allocate_inbox(ctx: Context<AllocateInbox>) -> Result<()> {
    require_settleable_agreement(&ctx.accounts.config, &ctx.accounts.agreement)?;

    let agreement_key = ctx.accounts.agreement.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    validate_existing_royalty_inbox(
        agreement_key,
        &ctx.accounts.agreement,
        vault_authority,
        ctx.accounts.royalty_inbox.key(),
        &ctx.accounts.royalty_inbox,
    )?;

    let accounting = inbox_accounting(&ctx.accounts.agreement, ctx.accounts.royalty_inbox.amount)?;
    require!(
        accounting.unallocated > 0,
        RoyaltyRailError::NoUnallocatedInboxFunds
    );

    let direct_nonce_before = ctx.accounts.agreement.direct_funding_nonce;
    let prepared = prepare_revenue_allocation(
        &ctx.accounts.config,
        &agreement_key,
        &ctx.accounts.agreement,
        accounting.unallocated,
        AllocationMode::Inbox,
        [0; 32],
    )?;
    apply_prepared_allocation(&mut ctx.accounts.agreement, &prepared)?;
    require!(
        ctx.accounts.agreement.direct_funding_nonce == direct_nonce_before,
        RoyaltyRailError::StalePreparedAllocation
    );

    emit!(RevenueAllocated {
        agreement: agreement_key,
        allocation_sequence: prepared.next_sequence,
        mode: AllocationMode::Inbox as u8,
        gross_amount: prepared.gross_amount,
        payment_reference: [0; 32],
        allocation_commitment: prepared.commitment,
    });

    Ok(())
}

pub fn process_claim_participant(
    ctx: Context<ClaimParticipant>,
    participant_index: u8,
) -> Result<()> {
    require_settleable_agreement(&ctx.accounts.config, &ctx.accounts.agreement)?;
    require!(
        ctx.accounts.settlement_mint.decimals == USDC_DECIMALS,
        RoyaltyRailError::InvalidSettlementMintDecimals
    );

    let agreement_key = ctx.accounts.agreement.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    validate_existing_royalty_inbox(
        agreement_key,
        &ctx.accounts.agreement,
        vault_authority,
        ctx.accounts.royalty_inbox.key(),
        &ctx.accounts.royalty_inbox,
    )?;

    let prepared = prepare_participant_claim(
        &ctx.accounts.config,
        &ctx.accounts.agreement,
        participant_index,
        ctx.accounts.royalty_inbox.amount,
    )?;
    validate_payout_destination(
        prepared.payout_wallet,
        ctx.accounts.agreement.settlement_mint,
        ctx.accounts.agreement.token_program,
        ctx.accounts.payout_destination.key(),
        &ctx.accounts.payout_destination,
    )?;

    let vault_bump = [ctx.bumps.vault_authority];
    let vault_signer_seeds: &[&[u8]] = &[VAULT_SEED, agreement_key.as_ref(), &vault_bump];
    let signer_seeds: &[&[&[u8]]] = &[vault_signer_seeds];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::TransferChecked {
                from: ctx.accounts.royalty_inbox.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.payout_destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        prepared.amount,
        ctx.accounts.settlement_mint.decimals,
    )?;

    apply_prepared_claim(&mut ctx.accounts.agreement, &prepared)?;

    emit!(PayoutClaimed {
        agreement: agreement_key,
        participant_index: prepared.participant_index,
        participant_authority: prepared.participant_authority,
        payout_wallet: prepared.payout_wallet,
        payout_revision: prepared.payout_revision,
        amount: prepared.amount,
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

    validate_royalty_inbox_token_fields(
        token_account.mint,
        token_account.owner,
        expected_mint,
        expected_authority,
    )
}

fn validate_royalty_inbox_token_fields(
    inbox_mint: Pubkey,
    inbox_authority: Pubkey,
    expected_mint: Pubkey,
    expected_authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        inbox_mint,
        expected_mint,
        RoyaltyRailError::InvalidRoyaltyInboxMint
    );
    require_keys_eq!(
        inbox_authority,
        expected_authority,
        RoyaltyRailError::InvalidRoyaltyInboxAuthority
    );
    Ok(())
}

fn validate_existing_royalty_inbox_fields(
    agreement_key: Pubkey,
    agreement: &AgreementVersionState,
    vault_authority: Pubkey,
    royalty_inbox_key: Pubkey,
    royalty_inbox_mint: Pubkey,
    royalty_inbox_authority: Pubkey,
) -> Result<()> {
    require_canonical_royalty_inbox(
        &ID,
        &agreement_key,
        agreement,
        &vault_authority,
        &royalty_inbox_key,
    )?;
    validate_royalty_inbox_token_fields(
        royalty_inbox_mint,
        royalty_inbox_authority,
        agreement.settlement_mint,
        vault_authority,
    )
}

fn validate_existing_royalty_inbox(
    agreement_key: Pubkey,
    agreement: &AgreementVersionState,
    vault_authority: Pubkey,
    royalty_inbox_key: Pubkey,
    royalty_inbox: &TokenAccount,
) -> Result<()> {
    validate_existing_royalty_inbox_fields(
        agreement_key,
        agreement,
        vault_authority,
        royalty_inbox_key,
        royalty_inbox.mint,
        royalty_inbox.owner,
    )
}

fn validate_payer_source_fields(
    source_mint: Pubkey,
    source_authority: Pubkey,
    expected_mint: Pubkey,
    payer: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        source_mint,
        expected_mint,
        RoyaltyRailError::InvalidPayerSourceMint
    );
    require_keys_eq!(
        source_authority,
        payer,
        RoyaltyRailError::InvalidPayerSourceAuthority
    );
    Ok(())
}

fn payout_destination_address(
    payout_wallet: &Pubkey,
    settlement_mint: &Pubkey,
    token_program: &Pubkey,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            payout_wallet.as_ref(),
            token_program.as_ref(),
            settlement_mint.as_ref(),
        ],
        &associated_token_program_id(),
    )
    .0
}

fn validate_payout_destination_fields(
    payout_wallet: Pubkey,
    settlement_mint: Pubkey,
    token_program: Pubkey,
    payout_destination_key: Pubkey,
    payout_destination_mint: Pubkey,
    payout_destination_authority: Pubkey,
) -> Result<()> {
    let expected = payout_destination_address(&payout_wallet, &settlement_mint, &token_program);
    require_keys_eq!(
        payout_destination_key,
        expected,
        RoyaltyRailError::InvalidPayoutDestinationAddress
    );
    require_keys_eq!(
        payout_destination_mint,
        settlement_mint,
        RoyaltyRailError::InvalidPayoutDestinationMint
    );
    require_keys_eq!(
        payout_destination_authority,
        payout_wallet,
        RoyaltyRailError::InvalidPayoutDestinationAuthority
    );
    Ok(())
}

fn validate_payout_destination(
    payout_wallet: Pubkey,
    settlement_mint: Pubkey,
    token_program: Pubkey,
    payout_destination_key: Pubkey,
    payout_destination: &TokenAccount,
) -> Result<()> {
    validate_payout_destination_fields(
        payout_wallet,
        settlement_mint,
        token_program,
        payout_destination_key,
        payout_destination.mint,
        payout_destination.owner,
    )
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

#[derive(Accounts)]
pub struct FundAndAllocate<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, agreement.revenue_pool.as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    #[account(address = config.settlement_mint @ RoyaltyRailError::SettlementConfigMismatch)]
    pub settlement_mint: Account<'info, Mint>,
    /// CHECK: canonical agreement vault PDA; it intentionally has no state account.
    #[account(seeds = [VAULT_SEED, agreement.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub royalty_inbox: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer_source: Account<'info, TokenAccount>,
    pub payer: Signer<'info>,
    #[account(address = config.token_program @ RoyaltyRailError::SettlementConfigMismatch)]
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AllocateInbox<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, agreement.revenue_pool.as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    /// CHECK: canonical agreement vault PDA; it intentionally has no state account.
    #[account(seeds = [VAULT_SEED, agreement.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub royalty_inbox: Account<'info, TokenAccount>,
    #[account(address = config.token_program @ RoyaltyRailError::SettlementConfigMismatch)]
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimParticipant<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfigState>,
    #[account(
        mut,
        seeds = [AGREEMENT_SEED, agreement.revenue_pool.as_ref(), &agreement.version.to_le_bytes()],
        bump = agreement.bump
    )]
    pub agreement: Account<'info, AgreementVersionState>,
    #[account(address = config.settlement_mint @ RoyaltyRailError::SettlementConfigMismatch)]
    pub settlement_mint: Account<'info, Mint>,
    /// CHECK: canonical agreement vault PDA; it intentionally has no state account.
    #[account(seeds = [VAULT_SEED, agreement.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub royalty_inbox: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payout_destination: Account<'info, TokenAccount>,
    #[account(address = config.token_program @ RoyaltyRailError::SettlementConfigMismatch)]
    pub token_program: Program<'info, Token>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        pda::royalty_inbox_address,
        state::{AgreementStatus, SCHEMA_VERSION_V1},
    };

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
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
            participants: Vec::new(),
            approval_bitmap: 0,
            supersession_approval_bitmap: 0,
            cumulative_gross: 0,
            direct_funding_nonce: 0,
            allocation_sequence: 0,
            created_slot: 1,
            activated_slot: 2,
            superseded_slot: 0,
            reserved: [0; 128],
        }
    }

    #[test]
    fn existing_royalty_inbox_rejects_address_mint_and_authority_substitution() {
        let agreement_key = key(70);
        let agreement = agreement();
        let (vault, _, inbox) = royalty_inbox_address(
            &ID,
            &agreement_key,
            &agreement.settlement_mint,
            &agreement.token_program,
        );

        assert!(validate_existing_royalty_inbox_fields(
            agreement_key,
            &agreement,
            vault,
            inbox,
            agreement.settlement_mint,
            vault,
        )
        .is_ok());
        assert!(validate_existing_royalty_inbox_fields(
            agreement_key,
            &agreement,
            vault,
            key(71),
            agreement.settlement_mint,
            vault,
        )
        .is_err());
        assert!(validate_existing_royalty_inbox_fields(
            agreement_key,
            &agreement,
            vault,
            inbox,
            key(72),
            vault,
        )
        .is_err());
        assert!(validate_existing_royalty_inbox_fields(
            agreement_key,
            &agreement,
            vault,
            inbox,
            agreement.settlement_mint,
            key(73),
        )
        .is_err());
    }

    #[test]
    fn payer_source_rejects_mint_or_authority_substitution() {
        let payer = key(20);
        let mint = key(4);

        assert!(validate_payer_source_fields(mint, payer, mint, payer).is_ok());
        assert!(validate_payer_source_fields(key(90), payer, mint, payer).is_err());
        assert!(validate_payer_source_fields(mint, key(91), mint, payer).is_err());
    }

    #[test]
    fn payout_destination_rejects_address_mint_and_authority_substitution() {
        let payout_wallet = key(80);
        let settlement_mint = key(4);
        let token_program = key(5);
        let payout_destination =
            payout_destination_address(&payout_wallet, &settlement_mint, &token_program);

        assert!(validate_payout_destination_fields(
            payout_wallet,
            settlement_mint,
            token_program,
            payout_destination,
            settlement_mint,
            payout_wallet,
        )
        .is_ok());
        assert!(validate_payout_destination_fields(
            payout_wallet,
            settlement_mint,
            token_program,
            key(81),
            settlement_mint,
            payout_wallet,
        )
        .is_err());
        assert!(validate_payout_destination_fields(
            payout_wallet,
            settlement_mint,
            token_program,
            payout_destination,
            key(82),
            payout_wallet,
        )
        .is_err());
        assert!(validate_payout_destination_fields(
            payout_wallet,
            settlement_mint,
            token_program,
            payout_destination,
            settlement_mint,
            key(83),
        )
        .is_err());
    }
}
