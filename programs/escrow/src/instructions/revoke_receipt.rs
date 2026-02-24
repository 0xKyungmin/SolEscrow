use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::error::EscrowError;
use crate::events::ReceiptRevoked;
use crate::state::*;

#[derive(Accounts)]
pub struct RevokeReceipt<'info> {
    /// Permissionless — anyone can call this after the receipt NFT is burned.
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// The receipt mint PDA — must match escrow_state.receipt_mint and have supply == 0.
    #[account(
        seeds = [RECEIPT_SEED, escrow_state.key().as_ref()],
        bump,
        constraint = Some(receipt_mint.key()) == escrow_state.receipt_mint @ EscrowError::MintMismatch,
        constraint = receipt_mint.supply == 0 @ EscrowError::ReceiptNotBurned,
    )]
    pub receipt_mint: Account<'info, Mint>,
}

pub fn handler(ctx: Context<RevokeReceipt>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;
    let receipt_mint_key = ctx.accounts.receipt_mint.key();

    // Clear the receipt_mint — this re-enables transfer_claim
    escrow.receipt_mint = None;

    emit!(ReceiptRevoked {
        escrow: escrow.key(),
        receipt_mint: receipt_mint_key,
    });

    Ok(())
}
