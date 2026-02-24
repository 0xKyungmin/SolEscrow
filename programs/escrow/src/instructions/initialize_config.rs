use anchor_lang::prelude::*;
use crate::error::EscrowError;
use crate::events::ConfigInitialized;
use crate::state::{EscrowConfig, ESCROW_CONFIG_SEED, MAX_DISPUTE_TIMEOUT};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + EscrowConfig::INIT_SPACE,
        seeds = [ESCROW_CONFIG_SEED],
        bump,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,

    /// CHECK: This is the fee collector wallet, validated by authority setting it.
    pub fee_collector: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeConfig>, fee_bps: u16, dispute_timeout: i64) -> Result<()> {
    require!(fee_bps <= 10_000, EscrowError::InvalidFeeRate);
    require!(dispute_timeout > 0 && dispute_timeout <= MAX_DISPUTE_TIMEOUT, EscrowError::InvalidDisputeTimeout);
    require!(
        ctx.accounts.fee_collector.key() != Pubkey::default(),
        EscrowError::InvalidFeeCollector
    );

    let config = &mut ctx.accounts.escrow_config;
    config.authority = ctx.accounts.authority.key();
    config.fee_bps = fee_bps;
    config.fee_collector = ctx.accounts.fee_collector.key();
    config.dispute_timeout = dispute_timeout;
    config.bump = ctx.bumps.escrow_config;

    emit!(ConfigInitialized {
        authority: config.authority,
        fee_bps: config.fee_bps,
        fee_collector: config.fee_collector,
        dispute_timeout: config.dispute_timeout,
    });

    Ok(())
}
