use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::EscrowError;
use crate::events::DisputeResolved;
use crate::helpers::{calculate_fee, escrow_seeds, transfer_from_vault};
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
        constraint = escrow_config.authority == authority.key() @ EscrowError::NotAuthority,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(constraint = mint.key() == escrow_state.mint @ EscrowError::MintMismatch)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = escrow_state,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = maker_token_account.owner == escrow_state.maker @ EscrowError::OwnerMismatch,
    )]
    pub maker_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = beneficiary_token_account.owner == escrow_state.beneficiary @ EscrowError::OwnerMismatch,
    )]
    pub beneficiary_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
        constraint = fee_collector_token_account.owner == escrow_config.fee_collector @ EscrowError::FeeCollectorMismatch,
    )]
    pub fee_collector_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ResolveDispute>, resolution: DisputeResolution) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    require!(
        escrow.status == EscrowStatus::Disputed,
        EscrowError::DisputeNotActive
    );

    // Authority must resolve before dispute timeout elapses
    let clock = Clock::get()?;
    if let Some(ref dispute) = escrow.dispute {
        let deadline = dispute
            .initiated_at
            .checked_add(dispute.timeout)
            .ok_or(EscrowError::Overflow)?;
        require!(clock.unix_timestamp <= deadline, EscrowError::EscrowExpired);
    }

    // If a receipt NFT exists, verify beneficiary is synced with current NFT holder.
    if escrow.receipt_mint.is_some() {
        crate::helpers::verify_receipt_sync(escrow, ctx.remaining_accounts)?;
    }

    if let DisputeResolution::Split { maker_bps } = &resolution {
        require!(*maker_bps <= 10_000, EscrowError::InvalidDisputeResolution);
    }

    let remaining = escrow
        .amount
        .checked_sub(escrow.released_amount)
        .ok_or(EscrowError::Overflow)?
        .checked_sub(escrow.refunded_amount)
        .ok_or(EscrowError::Overflow)?;

    // PDA signer seeds
    let maker_key = escrow.maker;
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    let decimals = ctx.accounts.mint.decimals;
    let fee_bps = escrow.fee_bps_at_creation as u64;

    // Pre-compute split amounts (used for both accounting and CPI)
    let (split_maker_share, split_taker_total) = if let DisputeResolution::Split { maker_bps } = &resolution {
        let maker_bps_val = *maker_bps as u64;
        let ms = remaining
            .checked_mul(maker_bps_val)
            .ok_or(EscrowError::Overflow)?
            .checked_div(10_000)
            .ok_or(EscrowError::Overflow)?;
        let ts = remaining.checked_sub(ms).ok_or(EscrowError::Overflow)?;
        (ms, ts)
    } else {
        (0, 0)
    };

    // Update milestones based on resolution (checks-effects-interactions)
    for milestone in escrow.milestones.iter_mut() {
        if milestone.status == MilestoneStatus::Pending
            || milestone.status == MilestoneStatus::Approved
        {
            match &resolution {
                DisputeResolution::MakerWins => {
                    milestone.status = MilestoneStatus::Cancelled;
                }
                DisputeResolution::TakerWins | DisputeResolution::Split { .. } => {
                    milestone.status = MilestoneStatus::Released;
                }
            }
        }
    }

    // Update released_amount/refunded_amount and status
    match &resolution {
        DisputeResolution::MakerWins => {
            escrow.refunded_amount = escrow.amount.checked_sub(escrow.released_amount).ok_or(EscrowError::Overflow)?;
            escrow.status = EscrowStatus::Cancelled;
        }
        DisputeResolution::TakerWins => {
            escrow.released_amount = escrow.amount.checked_sub(escrow.refunded_amount).ok_or(EscrowError::Overflow)?;
            escrow.status = EscrowStatus::Completed;
        }
        DisputeResolution::Split { .. } => {
            escrow.released_amount = escrow
                .released_amount
                .checked_add(split_taker_total)
                .ok_or(EscrowError::Overflow)?;
            escrow.refunded_amount = escrow
                .refunded_amount
                .checked_add(split_maker_share)
                .ok_or(EscrowError::Overflow)?;
            escrow.status = EscrowStatus::Completed;
        }
    }

    // Store resolution in dispute
    if let Some(ref mut dispute) = escrow.dispute {
        dispute.resolution = Some(resolution.clone());
    }

    // CPI transfers
    match &resolution {
        DisputeResolution::MakerWins => {
            transfer_from_vault(
                &ctx.accounts.vault, &ctx.accounts.mint,
                &ctx.accounts.maker_token_account,
                escrow.to_account_info(), &ctx.accounts.token_program,
                signer_seeds, remaining, decimals,
            )?;
        }
        DisputeResolution::TakerWins => {
            if remaining > 0 {
                let (fee, taker_amount) = calculate_fee(remaining, fee_bps)?;
                transfer_from_vault(
                    &ctx.accounts.vault, &ctx.accounts.mint,
                    &ctx.accounts.beneficiary_token_account,
                    escrow.to_account_info(), &ctx.accounts.token_program,
                    signer_seeds, taker_amount, decimals,
                )?;
                transfer_from_vault(
                    &ctx.accounts.vault, &ctx.accounts.mint,
                    &ctx.accounts.fee_collector_token_account,
                    escrow.to_account_info(), &ctx.accounts.token_program,
                    signer_seeds, fee, decimals,
                )?;
            }
        }
        DisputeResolution::Split { .. } => {
            let (fee, taker_amount) = calculate_fee(split_taker_total, fee_bps)?;

            transfer_from_vault(
                &ctx.accounts.vault, &ctx.accounts.mint,
                &ctx.accounts.maker_token_account,
                escrow.to_account_info(), &ctx.accounts.token_program,
                signer_seeds, split_maker_share, decimals,
            )?;
            transfer_from_vault(
                &ctx.accounts.vault, &ctx.accounts.mint,
                &ctx.accounts.beneficiary_token_account,
                escrow.to_account_info(), &ctx.accounts.token_program,
                signer_seeds, taker_amount, decimals,
            )?;
            transfer_from_vault(
                &ctx.accounts.vault, &ctx.accounts.mint,
                &ctx.accounts.fee_collector_token_account,
                escrow.to_account_info(), &ctx.accounts.token_program,
                signer_seeds, fee, decimals,
            )?;
        }
    }

    emit!(DisputeResolved {
        escrow: escrow.key(),
        resolution,
    });

    Ok(())
}
