#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF");

pub mod error;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod state;

use instructions::*;
use state::{DisputeResolution, MilestoneInput};

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        dispute_timeout: i64,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, fee_bps, dispute_timeout)
    }

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        seed: u64,
        amount: u64,
        milestones: Vec<MilestoneInput>,
        expires_at: i64,
    ) -> Result<()> {
        instructions::create_escrow::handler(ctx, seed, amount, milestones, expires_at)
    }

    pub fn approve_milestone(
        ctx: Context<ApproveMilestone>,
        milestone_index: u8,
    ) -> Result<()> {
        instructions::approve_milestone::handler(ctx, milestone_index)
    }

    pub fn release_milestone(
        ctx: Context<ReleaseMilestone>,
        milestone_index: u8,
    ) -> Result<()> {
        instructions::release_milestone::handler(ctx, milestone_index)
    }

    pub fn initiate_dispute(
        ctx: Context<InitiateDispute>,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        instructions::initiate_dispute::handler(ctx, reason_hash)
    }

    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        resolution: DisputeResolution,
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, resolution)
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        instructions::cancel_escrow::handler(ctx)
    }

    pub fn claim_expired(ctx: Context<ClaimExpired>) -> Result<()> {
        instructions::claim_expired::handler(ctx)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_authority: Option<Pubkey>,
        fee_bps: Option<u16>,
        dispute_timeout: Option<i64>,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, new_authority, fee_bps, dispute_timeout)
    }

    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        instructions::close_escrow::handler(ctx)
    }

    pub fn transfer_claim(ctx: Context<TransferClaim>) -> Result<()> {
        instructions::transfer_claim::handler(ctx)
    }

    pub fn mint_receipt(ctx: Context<MintReceipt>) -> Result<()> {
        instructions::mint_receipt::handler(ctx)
    }

    pub fn sync_beneficiary(ctx: Context<SyncBeneficiary>) -> Result<()> {
        instructions::sync_beneficiary::handler(ctx)
    }

    pub fn revoke_receipt(ctx: Context<RevokeReceipt>) -> Result<()> {
        instructions::revoke_receipt::handler(ctx)
    }
}
