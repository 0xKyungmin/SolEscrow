use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::EscrowError;
use crate::events::ExpiredFundsClaimed;
use crate::helpers::{calculate_fee, escrow_seeds, transfer_from_vault};
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimExpired<'info> {
    /// Anyone can crank this permissionless instruction.
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,

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
        constraint = maker_token_account.owner == escrow_state.maker @ EscrowError::OwnerMismatch,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub maker_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Beneficiary token account for dispute timeout 50/50 split.
    #[account(
        mut,
        constraint = beneficiary_token_account.owner == escrow_state.beneficiary @ EscrowError::OwnerMismatch,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub beneficiary_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Fee collector token account for dispute timeout fee.
    #[account(
        mut,
        constraint = fee_collector_token_account.owner == escrow_config.fee_collector @ EscrowError::FeeCollectorMismatch,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub fee_collector_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ClaimExpired>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;
    let clock = Clock::get()?;

    let is_active_expired = escrow.status == EscrowStatus::Active
        && clock.unix_timestamp > escrow.expires_at;
    let is_dispute_timed_out = escrow.status == EscrowStatus::Disputed
        && escrow.dispute.as_ref().is_some_and(|d| {
            d.initiated_at
                .checked_add(d.timeout)
                .is_some_and(|deadline| clock.unix_timestamp > deadline)
        });
    require!(is_active_expired || is_dispute_timed_out, EscrowError::EscrowNotExpired);

    // Calculate remaining (unreleased and unrefunded) amount
    let remaining = escrow
        .amount
        .checked_sub(escrow.released_amount)
        .ok_or(EscrowError::Overflow)?
        .checked_sub(escrow.refunded_amount)
        .ok_or(EscrowError::Overflow)?;

    require!(remaining > 0, EscrowError::NoRefundableAmount);

    // If a receipt NFT exists, verify beneficiary is synced with current NFT holder.
    if escrow.receipt_mint.is_some() {
        crate::helpers::verify_receipt_sync(escrow, ctx.remaining_accounts)?;
    }

    // Calculate approved and pending amounts for the is_active_expired path
    let mut approved_amount: u64 = 0;
    let mut pending_amount: u64 = 0;
    let mut dispute_maker_share: u64 = 0;
    let mut dispute_taker_share: u64 = 0;
    for milestone in escrow.milestones.iter() {
        match milestone.status {
            MilestoneStatus::Approved => {
                approved_amount = approved_amount
                    .checked_add(milestone.amount)
                    .ok_or(EscrowError::Overflow)?;
            }
            MilestoneStatus::Pending => {
                pending_amount = pending_amount
                    .checked_add(milestone.amount)
                    .ok_or(EscrowError::Overflow)?;
            }
            _ => {}
        }
    }

    let fee_bps = escrow.fee_bps_at_creation as u64;

    // Update state BEFORE CPI (checks-effects-interactions)
    if is_active_expired {
        // Active expired: Approved milestones are Released (earned), Pending are Cancelled
        for milestone in escrow.milestones.iter_mut() {
            match milestone.status {
                MilestoneStatus::Approved => {
                    milestone.status = MilestoneStatus::Released;
                }
                MilestoneStatus::Pending => {
                    milestone.status = MilestoneStatus::Cancelled;
                }
                _ => {}
            }
        }
        escrow.released_amount = escrow
            .released_amount
            .checked_add(approved_amount)
            .ok_or(EscrowError::Overflow)?;
        escrow.refunded_amount = escrow
            .refunded_amount
            .checked_add(pending_amount)
            .ok_or(EscrowError::Overflow)?;
    } else {
        // Dispute timed out: cancel all non-terminal milestones
        for milestone in escrow.milestones.iter_mut() {
            if milestone.status == MilestoneStatus::Pending
                || milestone.status == MilestoneStatus::Approved
            {
                milestone.status = MilestoneStatus::Cancelled;
            }
        }
        // 50/50 split — compute once, reuse for both accounting and CPI
        dispute_maker_share = remaining
            .checked_div(2)
            .ok_or(EscrowError::Overflow)?;
        dispute_taker_share = remaining
            .checked_sub(dispute_maker_share)
            .ok_or(EscrowError::Overflow)?;
        escrow.refunded_amount = escrow
            .refunded_amount
            .checked_add(dispute_maker_share)
            .ok_or(EscrowError::Overflow)?;
        escrow.released_amount = escrow
            .released_amount
            .checked_add(dispute_taker_share)
            .ok_or(EscrowError::Overflow)?;
    }
    escrow.status = EscrowStatus::Expired;

    // PDA signer seeds
    let maker_key = escrow.maker;
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    let decimals = ctx.accounts.mint.decimals;

    // CPI transfers
    if is_active_expired {
        // Active escrow expired: refund pending to maker, release approved to beneficiary
        if pending_amount > 0 {
            transfer_from_vault(
                &ctx.accounts.vault, &ctx.accounts.mint,
                &ctx.accounts.maker_token_account,
                escrow.to_account_info(), &ctx.accounts.token_program,
                signer_seeds, pending_amount, decimals,
            )?;
        }

        if approved_amount > 0 {
            let (fee, beneficiary_net) = calculate_fee(approved_amount, fee_bps)?;

            if beneficiary_net > 0 {
                transfer_from_vault(
                    &ctx.accounts.vault, &ctx.accounts.mint,
                    &ctx.accounts.beneficiary_token_account,
                    escrow.to_account_info(), &ctx.accounts.token_program,
                    signer_seeds, beneficiary_net, decimals,
                )?;
            }

            if fee > 0 {
                transfer_from_vault(
                    &ctx.accounts.vault, &ctx.accounts.mint,
                    &ctx.accounts.fee_collector_token_account,
                    escrow.to_account_info(), &ctx.accounts.token_program,
                    signer_seeds, fee, decimals,
                )?;
            }
        }
    } else {
        // Dispute timed out: reuse pre-computed 50/50 shares
        let (fee, taker_amount) = calculate_fee(dispute_taker_share, fee_bps)?;

        transfer_from_vault(
            &ctx.accounts.vault, &ctx.accounts.mint,
            &ctx.accounts.maker_token_account,
            escrow.to_account_info(), &ctx.accounts.token_program,
            signer_seeds, dispute_maker_share, decimals,
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

    emit!(ExpiredFundsClaimed {
        escrow: escrow.key(),
        amount: remaining,
        approved_released: if is_active_expired { approved_amount } else { 0 },
        pending_refunded: if is_active_expired { pending_amount } else { 0 },
        dispute_maker_share,
        dispute_taker_share,
    });

    Ok(())
}
