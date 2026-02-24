use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::EscrowError;
use crate::events::{EscrowCompleted, MilestoneReleased};
use crate::helpers::{calculate_fee, escrow_seeds, transfer_from_vault};
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_index: u8)]
pub struct ReleaseMilestone<'info> {
    /// Anyone can crank this instruction after milestone is approved.
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

pub fn handler(ctx: Context<ReleaseMilestone>, milestone_index: u8) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive
    );

    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    let idx = milestone_index as usize;
    require!(idx < escrow.milestones.len(), EscrowError::MilestoneIndexOutOfBounds);
    require!(
        escrow.milestones[idx].status == MilestoneStatus::Approved,
        EscrowError::MilestoneNotApproved
    );

    // If a receipt NFT exists, verify beneficiary is synced with current NFT holder.
    if escrow.receipt_mint.is_some() {
        crate::helpers::verify_receipt_sync(escrow, ctx.remaining_accounts)?;
    }

    let milestone_amount = escrow.milestones[idx].amount;
    let (fee, taker_amount) = calculate_fee(milestone_amount, escrow.fee_bps_at_creation as u64)?;

    // Update state BEFORE CPI (checks-effects-interactions)
    escrow.milestones[idx].status = MilestoneStatus::Released;
    escrow.released_amount = escrow
        .released_amount
        .checked_add(milestone_amount)
        .ok_or(EscrowError::Overflow)?;

    // PDA signer seeds
    let maker_key = escrow.maker;
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    let decimals = ctx.accounts.mint.decimals;

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

    emit!(MilestoneReleased {
        escrow: escrow.key(),
        milestone_index,
        amount: milestone_amount,
        fee,
    });

    let all_settled = escrow.all_milestones_settled();

    if all_settled {
        escrow.status = EscrowStatus::Completed;
        emit!(EscrowCompleted {
            escrow: escrow.key(),
            total_released: escrow.released_amount,
        });
    }

    Ok(())
}
