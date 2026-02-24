use anchor_lang::prelude::*;

pub const MAX_MILESTONES: usize = 5;
pub const ESCROW_CONFIG_SEED: &[u8] = b"escrow_config";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const MIN_EXPIRATION_DURATION: i64 = 3600; // 1 hour minimum
pub const MAX_DISPUTE_TIMEOUT: i64 = 365 * 24 * 3600; // 1 year maximum

#[account]
#[derive(InitSpace)]
pub struct EscrowConfig {
    pub authority: Pubkey,
    pub fee_bps: u16,
    pub fee_collector: Pubkey,
    pub dispute_timeout: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum EscrowStatus {
    Active,
    Completed,
    Disputed,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum MilestoneStatus {
    Pending,
    Approved,
    Released,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Milestone {
    pub amount: u64,
    pub description_hash: [u8; 32],
    pub status: MilestoneStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq)]
pub enum DisputeResolution {
    MakerWins,
    TakerWins,
    Split { maker_bps: u16 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Dispute {
    pub initiator: Pubkey,
    pub reason_hash: [u8; 32],
    pub initiated_at: i64,
    pub timeout: i64,
    pub resolution: Option<DisputeResolution>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowState {
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub released_amount: u64,
    pub refunded_amount: u64,
    pub seed: u64,
    pub status: EscrowStatus,
    #[max_len(MAX_MILESTONES)]
    pub milestones: Vec<Milestone>,
    pub created_at: i64,
    pub expires_at: i64,
    pub dispute: Option<Dispute>,
    pub fee_bps_at_creation: u16,
    pub bump: u8,
    pub receipt_mint: Option<Pubkey>,
}

impl EscrowState {
    /// Returns true when every milestone has reached a terminal status.
    pub fn all_milestones_settled(&self) -> bool {
        self.milestones.iter().all(|m| {
            m.status == MilestoneStatus::Released || m.status == MilestoneStatus::Cancelled
        })
    }
}

/// Input struct for creating milestones (used as instruction argument).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MilestoneInput {
    pub amount: u64,
    pub description_hash: [u8; 32],
}
