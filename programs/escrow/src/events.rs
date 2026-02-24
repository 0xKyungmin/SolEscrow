use anchor_lang::prelude::*;
use crate::state::DisputeResolution;

#[event]
pub struct EscrowCreated {
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub seed: u64,
    pub milestones_count: u8,
    pub expires_at: i64,
}

#[event]
pub struct MilestoneApproved {
    pub escrow: Pubkey,
    pub milestone_index: u8,
}

#[event]
pub struct MilestoneReleased {
    pub escrow: Pubkey,
    pub milestone_index: u8,
    pub amount: u64,
    pub fee: u64,
}

#[event]
pub struct DisputeInitiated {
    pub escrow: Pubkey,
    pub initiator: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub resolution: DisputeResolution,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub refunded_amount: u64,
}

#[event]
pub struct EscrowCompleted {
    pub escrow: Pubkey,
    pub total_released: u64,
}

#[event]
pub struct ExpiredFundsClaimed {
    pub escrow: Pubkey,
    pub amount: u64,
    pub approved_released: u64,
    pub pending_refunded: u64,
    pub dispute_maker_share: u64,
    pub dispute_taker_share: u64,
}

#[event]
pub struct ClaimTransferred {
    pub escrow: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
}

#[event]
pub struct ReceiptMinted {
    pub escrow: Pubkey,
    pub mint: Pubkey,
    pub beneficiary: Pubkey,
}

#[event]
pub struct BeneficiarySynced {
    pub escrow: Pubkey,
    pub old_beneficiary: Pubkey,
    pub new_beneficiary: Pubkey,
}

#[event]
pub struct ReceiptRevoked {
    pub escrow: Pubkey,
    pub receipt_mint: Pubkey,
}

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub fee_collector: Pubkey,
    pub dispute_timeout: i64,
}

#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub fee_collector: Pubkey,
    pub dispute_timeout: i64,
}

#[event]
pub struct EscrowClosed {
    pub escrow: Pubkey,
    pub maker: Pubkey,
}
