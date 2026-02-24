use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};

use crate::error::EscrowError;
use crate::events::BeneficiarySynced;
use crate::state::*;

#[derive(Accounts)]
pub struct SyncBeneficiary<'info> {
    /// Permissionless — anyone can call this to sync the beneficiary.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// The receipt mint PDA — must match escrow_state.receipt_mint.
    #[account(
        seeds = [RECEIPT_SEED, escrow_state.key().as_ref()],
        bump,
        constraint = Some(receipt_mint.key()) == escrow_state.receipt_mint @ EscrowError::MintMismatch,
    )]
    pub receipt_mint: Account<'info, Mint>,

    /// The token account currently holding the receipt NFT (amount must be 1).
    #[account(
        constraint = receipt_token_account.mint == receipt_mint.key() @ EscrowError::MintMismatch,
        constraint = receipt_token_account.amount == 1 @ EscrowError::InvalidReceiptHolder,
    )]
    pub receipt_token_account: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<SyncBeneficiary>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    // Allow sync in Active or Disputed states (needed to unblock resolve_dispute/claim_expired
    // when receipt NFT changes hands during a dispute)
    require!(
        escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::Disputed,
        EscrowError::EscrowNotActive
    );

    let new_beneficiary = ctx.accounts.receipt_token_account.owner;

    // Already synced — no-op would waste compute
    require!(
        new_beneficiary != escrow.beneficiary,
        EscrowError::BeneficiaryAlreadySynced
    );

    // Cannot transfer claim to maker
    require!(
        new_beneficiary != escrow.maker,
        EscrowError::InvalidBeneficiary
    );

    // Cannot transfer claim to zero address
    require!(
        new_beneficiary != Pubkey::default(),
        EscrowError::InvalidBeneficiary
    );

    let old_beneficiary = escrow.beneficiary;
    escrow.beneficiary = new_beneficiary;

    emit!(BeneficiarySynced {
        escrow: escrow.key(),
        old_beneficiary,
        new_beneficiary,
    });

    Ok(())
}
