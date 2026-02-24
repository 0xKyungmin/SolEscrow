use anchor_lang::prelude::*;
use crate::error::EscrowError;
use crate::events::ConfigUpdated;
use crate::state::{EscrowConfig, ESCROW_CONFIG_SEED, MAX_DISPUTE_TIMEOUT};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
        constraint = escrow_config.authority == authority.key() @ EscrowError::NotAuthority,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,

    /// CHECK: New fee collector, validated by authority setting it.
    pub fee_collector: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    new_authority: Option<Pubkey>,
    fee_bps: Option<u16>,
    dispute_timeout: Option<i64>,
) -> Result<()> {
    let config = &mut ctx.accounts.escrow_config;

    if let Some(bps) = fee_bps {
        require!(bps <= 10_000, EscrowError::InvalidFeeRate);
        config.fee_bps = bps;
    }

    if let Some(timeout) = dispute_timeout {
        require!(timeout > 0 && timeout <= MAX_DISPUTE_TIMEOUT, EscrowError::InvalidDisputeTimeout);
        config.dispute_timeout = timeout;
    }

    let new_fee_collector = ctx.accounts.fee_collector.key();
    require!(new_fee_collector != Pubkey::default(), EscrowError::InvalidFeeCollector);
    if new_fee_collector != config.fee_collector {
        config.fee_collector = new_fee_collector;
    }

    if let Some(new_auth) = new_authority {
        require!(new_auth != Pubkey::default(), EscrowError::InvalidAuthority);
        config.authority = new_auth;
    }

    emit!(ConfigUpdated {
        authority: config.authority,
        fee_bps: config.fee_bps,
        fee_collector: config.fee_collector,
        dispute_timeout: config.dispute_timeout,
    });

    Ok(())
}
