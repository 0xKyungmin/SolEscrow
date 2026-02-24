use anchor_lang::prelude::*;

use crate::error::EscrowError;
use crate::events::ClaimTransferred;
use crate::state::*;

#[derive(Accounts)]
pub struct TransferClaim<'info> {
    /// Current beneficiary must sign to transfer their claim.
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = escrow_state.beneficiary == beneficiary.key() @ EscrowError::NotBeneficiary,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    /// CHECK: The new beneficiary receiving the claim.
    pub new_beneficiary: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<TransferClaim>) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    // Block transfer_claim when receipt NFT exists — use NFT transfer + sync_beneficiary instead
    require!(escrow.receipt_mint.is_none(), EscrowError::ReceiptExists);

    require!(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    require!(
        ctx.accounts.new_beneficiary.key() != escrow.maker,
        EscrowError::InvalidBeneficiary
    );
    require!(
        ctx.accounts.new_beneficiary.key() != Pubkey::default(),
        EscrowError::InvalidBeneficiary
    );

    let old_beneficiary = escrow.beneficiary;
    escrow.beneficiary = ctx.accounts.new_beneficiary.key();

    emit!(ClaimTransferred {
        escrow: escrow.key(),
        from: old_beneficiary,
        to: escrow.beneficiary,
    });

    Ok(())
}
