use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount as SplTokenAccount;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::error::EscrowError;
use crate::state::{EscrowState, ESCROW_SEED};

/// Build escrow PDA signer seeds inner array.
pub fn escrow_seeds<'a>(
    maker: &'a Pubkey,
    seed_bytes: &'a [u8; 8],
    bump: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [ESCROW_SEED, maker.as_ref(), seed_bytes.as_ref(), bump]
}

/// Transfer tokens from vault using PDA signer. Skips if amount == 0.
#[allow(clippy::too_many_arguments)]
pub fn transfer_from_vault<'info>(
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    destination: &InterfaceAccount<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    token_program: &Interface<'info, TokenInterface>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let transfer_accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: destination.to_account_info(),
        authority,
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        transfer_accounts,
        signer_seeds,
    );
    token_interface::transfer_checked(cpi_ctx, amount, decimals)
}

/// Calculate fee and net amount. Returns (fee, net) where net = amount - fee.
/// Uses u128 intermediate to avoid overflow for large amounts.
pub fn calculate_fee(amount: u64, fee_bps: u64) -> Result<(u64, u64)> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(EscrowError::Overflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::Overflow)? as u64;
    let net = amount
        .checked_sub(fee)
        .ok_or(EscrowError::Overflow)?;
    Ok((fee, net))
}

/// Verify that the receipt NFT holder matches `escrow.beneficiary`.
/// Must be called when `escrow.receipt_mint.is_some()`.
/// Expects `remaining_accounts[0]` to be the receipt token account.
pub fn verify_receipt_sync(
    escrow: &EscrowState,
    remaining_accounts: &[AccountInfo],
) -> Result<()> {
    require!(
        !remaining_accounts.is_empty(),
        EscrowError::BeneficiaryNotSynced
    );
    let receipt_info = &remaining_accounts[0];
    require!(
        receipt_info.owner == &anchor_spl::token::ID,
        EscrowError::BeneficiaryNotSynced
    );
    let data = receipt_info.try_borrow_data()?;
    let receipt_token = SplTokenAccount::try_deserialize(&mut &data[..])
        .map_err(|_| error!(EscrowError::BeneficiaryNotSynced))?;
    require!(
        receipt_token.mint == escrow.receipt_mint.unwrap(),
        EscrowError::MintMismatch
    );
    require!(receipt_token.amount == 1, EscrowError::InvalidReceiptHolder);
    require!(
        receipt_token.owner == escrow.beneficiary,
        EscrowError::BeneficiaryNotSynced
    );
    Ok(())
}
