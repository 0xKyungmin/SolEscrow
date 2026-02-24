use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::error::EscrowError;
use crate::events::EscrowCreated;
use crate::state::*;

#[derive(Accounts)]
#[instruction(seed: u64, amount: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    /// CHECK: The taker is just stored as a pubkey reference; no signing required at creation.
    pub taker: UncheckedAccount<'info>,

    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = maker,
        space = 8 + EscrowState::INIT_SPACE,
        seeds = [ESCROW_SEED, maker.key().as_ref(), seed.to_le_bytes().as_ref()],
        bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        init,
        payer = maker,
        associated_token::mint = mint,
        associated_token::authority = escrow_state,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = maker_token_account.amount >= amount @ EscrowError::InsufficientBalance,
        associated_token::mint = mint,
        associated_token::authority = maker,
        associated_token::token_program = token_program,
    )]
    pub maker_token_account: InterfaceAccount<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateEscrow>,
    seed: u64,
    amount: u64,
    milestones: Vec<MilestoneInput>,
    expires_at: i64,
) -> Result<()> {
    let milestone_count = milestones.len();
    require!(
        (1..=MAX_MILESTONES).contains(&milestone_count),
        EscrowError::InvalidMilestoneCount
    );

    // Validate amount is non-zero
    require!(amount > 0, EscrowError::InvalidAmount);

    // Validate maker != taker
    require!(
        ctx.accounts.maker.key() != ctx.accounts.taker.key(),
        EscrowError::SelfEscrow
    );

    // Validate milestone amounts sum to total
    let mut milestone_sum: u64 = 0;
    for m in &milestones {
        require!(m.amount > 0, EscrowError::InvalidAmount);
        milestone_sum = milestone_sum
            .checked_add(m.amount)
            .ok_or(EscrowError::Overflow)?;
    }
    require!(milestone_sum == amount, EscrowError::MilestoneAmountMismatch);

    // Enforce minimum expiration duration (1 hour) — also ensures expires_at is in the future
    let clock = Clock::get()?;
    require!(
        expires_at >= clock.unix_timestamp
            .checked_add(MIN_EXPIRATION_DURATION)
            .ok_or(EscrowError::Overflow)?,
        EscrowError::InvalidExpiration
    );

    // Reject Token-2022 mints to prevent transfer-fee accounting issues.
    // Classic SPL Token mints are owned by TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA.
    require!(
        *ctx.accounts.mint.to_account_info().owner == anchor_spl::token::ID,
        EscrowError::ExtendedMintNotSupported
    );

    // Reject mints with a freeze authority to prevent vault freeze griefing.
    require!(
        ctx.accounts.mint.freeze_authority.is_none(),
        EscrowError::MintHasFreezeAuthority
    );

    // Build milestone structs
    let milestone_structs: Vec<Milestone> = milestones
        .iter()
        .map(|m| Milestone {
            amount: m.amount,
            description_hash: m.description_hash,
            status: MilestoneStatus::Pending,
        })
        .collect();

    // Transfer tokens from maker to vault
    let transfer_accounts = TransferChecked {
        from: ctx.accounts.maker_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.maker.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    token_interface::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

    // Initialize escrow state
    let escrow = &mut ctx.accounts.escrow_state;
    escrow.maker = ctx.accounts.maker.key();
    escrow.taker = ctx.accounts.taker.key();
    escrow.beneficiary = ctx.accounts.taker.key();
    escrow.mint = ctx.accounts.mint.key();
    escrow.amount = amount;
    escrow.released_amount = 0;
    escrow.refunded_amount = 0;
    escrow.seed = seed;
    escrow.status = EscrowStatus::Active;
    escrow.milestones = milestone_structs;
    escrow.created_at = clock.unix_timestamp;
    escrow.expires_at = expires_at;
    escrow.dispute = None;
    escrow.bump = ctx.bumps.escrow_state;
    escrow.fee_bps_at_creation = ctx.accounts.escrow_config.fee_bps;
    escrow.receipt_mint = None;

    emit!(EscrowCreated {
        maker: escrow.maker,
        taker: escrow.taker,
        mint: escrow.mint,
        amount,
        seed,
        milestones_count: milestone_count as u8,
        expires_at,
    });

    Ok(())
}
