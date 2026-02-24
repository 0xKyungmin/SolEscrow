use anchor_lang::prelude::*;

use crate::error::EscrowError;
use crate::events::DisputeInitiated;
use crate::state::*;

#[derive(Accounts)]
pub struct InitiateDispute<'info> {
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = (escrow_state.maker == initiator.key() || escrow_state.taker == initiator.key() || escrow_state.beneficiary == initiator.key()) @ EscrowError::NotEscrowParty,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,
}

pub fn handler(ctx: Context<InitiateDispute>, reason_hash: [u8; 32]) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    require!(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive);
    require!(escrow.dispute.is_none(), EscrowError::DisputeAlreadyActive);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    escrow.status = EscrowStatus::Disputed;
    escrow.dispute = Some(Dispute {
        initiator: ctx.accounts.initiator.key(),
        reason_hash,
        initiated_at: clock.unix_timestamp,
        timeout: ctx.accounts.escrow_config.dispute_timeout,
        resolution: None,
    });

    emit!(DisputeInitiated {
        escrow: escrow.key(),
        initiator: ctx.accounts.initiator.key(),
    });

    Ok(())
}
