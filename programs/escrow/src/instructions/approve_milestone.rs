use anchor_lang::prelude::*;

use crate::error::EscrowError;
use crate::events::MilestoneApproved;
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_index: u8)]
pub struct ApproveMilestone<'info> {
    pub maker: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = escrow_state.maker == maker.key() @ EscrowError::NotMaker,
    )]
    pub escrow_state: Account<'info, EscrowState>,
}

pub fn handler(ctx: Context<ApproveMilestone>, milestone_index: u8) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_state;

    require!(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    let idx = milestone_index as usize;
    require!(idx < escrow.milestones.len(), EscrowError::MilestoneIndexOutOfBounds);
    require!(
        escrow.milestones[idx].status == MilestoneStatus::Pending,
        EscrowError::MilestoneNotPending
    );

    escrow.milestones[idx].status = MilestoneStatus::Approved;

    emit!(MilestoneApproved {
        escrow: escrow.key(),
        milestone_index,
    });

    Ok(())
}
