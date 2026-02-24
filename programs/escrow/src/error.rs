use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Signer is not a party (maker, taker, or beneficiary) of this escrow")]
    NotEscrowParty,

    #[msg("Signer is not the maker of this escrow")]
    NotMaker,

    #[msg("Signer is not the config authority")]
    NotAuthority,

    #[msg("Signer is not the current beneficiary")]
    NotBeneficiary,

    #[msg("Token mint does not match escrow mint")]
    MintMismatch,

    #[msg("Token account owner does not match expected owner")]
    OwnerMismatch,

    #[msg("Fee collector token account does not match config")]
    FeeCollectorMismatch,

    #[msg("Fee rate must be <= 10000 basis points")]
    InvalidFeeRate,

    #[msg("Milestone count must be between 1 and 5")]
    InvalidMilestoneCount,

    #[msg("Milestone index out of bounds")]
    MilestoneIndexOutOfBounds,

    #[msg("Sum of milestone amounts must equal total escrow amount")]
    MilestoneAmountMismatch,

    #[msg("Expiration must be in the future")]
    InvalidExpiration,

    #[msg("Escrow is not in Active status")]
    EscrowNotActive,

    #[msg("Escrow has expired")]
    EscrowExpired,

    #[msg("Milestone is not in Pending status")]
    MilestoneNotPending,

    #[msg("Milestone is not in Approved status")]
    MilestoneNotApproved,

    #[msg("A dispute is already active on this escrow")]
    DisputeAlreadyActive,

    #[msg("No active dispute on this escrow")]
    DisputeNotActive,

    #[msg("Invalid dispute resolution: split basis points must be <= 10000")]
    InvalidDisputeResolution,

    #[msg("Escrow has not expired yet")]
    EscrowNotExpired,

    #[msg("No refundable amount available")]
    NoRefundableAmount,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Escrow must be in a terminal state (Completed, Cancelled, or Expired)")]
    EscrowNotTerminal,

    #[msg("Escrow amount must be greater than zero")]
    InvalidAmount,

    #[msg("Dispute timeout must be greater than zero")]
    InvalidDisputeTimeout,

    #[msg("Maker and taker cannot be the same address")]
    SelfEscrow,

    #[msg("Cannot transfer claim to maker or zero address")]
    InvalidBeneficiary,

    #[msg("Extended mints (with transfer fees) are not supported")]
    ExtendedMintNotSupported,

    #[msg("Authority cannot be set to the zero address")]
    InvalidAuthority,

    #[msg("Fee collector cannot be the zero address")]
    InvalidFeeCollector,

    #[msg("NFT receipt has already been minted for this escrow")]
    ReceiptAlreadyMinted,

    #[msg("Insufficient token balance to fund the escrow")]
    InsufficientBalance,

    #[msg("Receipt NFT exists — use NFT transfer + sync_beneficiary instead of transfer_claim")]
    ReceiptExists,

    #[msg("Beneficiary is already synced with the current NFT holder")]
    BeneficiaryAlreadySynced,

    #[msg("Receipt token account holder is invalid (must not be maker or zero address)")]
    InvalidReceiptHolder,

    #[msg("Beneficiary is not synced with current receipt NFT holder — call sync_beneficiary first")]
    BeneficiaryNotSynced,

    #[msg("Receipt NFT has not been burned (supply > 0) — cannot revoke")]
    ReceiptNotBurned,

    #[msg("Mints with a freeze authority are not supported (vault freeze griefing risk)")]
    MintHasFreezeAuthority,
}
