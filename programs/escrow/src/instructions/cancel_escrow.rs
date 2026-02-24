use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::EscrowError;
use crate::events::EscrowCancelled;
use crate::helpers::{escrow_seeds, transfer_from_vault};
use crate::state::*;

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = escrow_state.maker == maker.key() @ EscrowError::NotMaker,
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
        constraint = maker_token_account.owner == escrow_state.maker @ EscrowError::OwnerMismatch,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub maker_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<CancelEscrow>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive
    );

    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    // Sum up amounts for Pending milestones only.
    // Approved milestones are intentionally skipped — they represent accepted work
    // that the taker can still claim via release_milestone.
    let mut refund_amount: u64 = 0;
    for milestone in escrow.milestones.iter_mut() {
        if milestone.status == MilestoneStatus::Pending {
            refund_amount = refund_amount
                .checked_add(milestone.amount)
                .ok_or(EscrowError::Overflow)?;
            milestone.status = MilestoneStatus::Cancelled;
        }
    }

    require!(refund_amount > 0, EscrowError::NoRefundableAmount);

    // Update state BEFORE CPI (checks-effects-interactions)
    escrow.refunded_amount = escrow
        .refunded_amount
        .checked_add(refund_amount)
        .ok_or(EscrowError::Overflow)?;

    // PDA signer seeds
    let maker_key = escrow.maker;
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    transfer_from_vault(
        &ctx.accounts.vault, &ctx.accounts.mint,
        &ctx.accounts.maker_token_account,
        escrow.to_account_info(), &ctx.accounts.token_program,
        signer_seeds, refund_amount, ctx.accounts.mint.decimals,
    )?;

    let all_settled = escrow.all_milestones_settled();

    if all_settled {
        escrow.status = EscrowStatus::Cancelled;
    }

    emit!(EscrowCancelled {
        escrow: escrow.key(),
        refunded_amount: refund_amount,
    });

    Ok(())
}
