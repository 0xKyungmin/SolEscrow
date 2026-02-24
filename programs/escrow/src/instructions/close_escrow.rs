use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface};

use crate::error::EscrowError;
use crate::events::EscrowClosed;
use crate::helpers::{escrow_seeds, transfer_from_vault};
use crate::state::*;

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = escrow_state.maker == maker.key() @ EscrowError::NotMaker,
        close = maker,
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

pub fn handler(ctx: Context<CloseEscrow>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_state;

    require!(
        escrow.status == EscrowStatus::Completed
            || escrow.status == EscrowStatus::Cancelled
            || escrow.status == EscrowStatus::Expired,
        EscrowError::EscrowNotTerminal
    );

    // Sweep any dust left in the vault (e.g. griefing deposits) back to maker
    // before closing. This prevents an attacker from sending 1 token to the
    // vault ATA to permanently block closure.
    let maker_key = escrow.maker;
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    let dust = ctx.accounts.vault.amount;
    if dust > 0 {
        transfer_from_vault(
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.maker_token_account,
            ctx.accounts.escrow_state.to_account_info(),
            &ctx.accounts.token_program,
            signer_seeds,
            dust,
            ctx.accounts.mint.decimals,
        )?;
    }

    // Emit event BEFORE account is closed
    emit!(EscrowClosed {
        escrow: escrow.key(),
        maker: escrow.maker,
    });

    let close_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.maker.to_account_info(),
        authority: ctx.accounts.escrow_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        close_accounts,
        signer_seeds,
    );
    token_interface::close_account(cpi_ctx)?;

    Ok(())
}
