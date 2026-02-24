use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_master_edition_v3, create_metadata_accounts_v3,
        mpl_token_metadata::types::DataV2,
        CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
    },
    token::{self, Mint, MintTo, Token, TokenAccount},
};

use crate::error::EscrowError;
use crate::events::ReceiptMinted;
use crate::helpers::escrow_seeds;
use crate::state::*;

#[derive(Accounts)]
pub struct MintReceipt<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,

    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow_state.maker.as_ref(), escrow_state.seed.to_le_bytes().as_ref()],
        bump = escrow_state.bump,
        constraint = escrow_state.beneficiary == beneficiary.key() @ EscrowError::NotBeneficiary,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        init,
        payer = beneficiary,
        mint::decimals = 0,
        mint::authority = escrow_state,
        mint::freeze_authority = escrow_state,
        seeds = [RECEIPT_SEED, escrow_state.key().as_ref()],
        bump,
    )]
    pub receipt_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = beneficiary,
        associated_token::mint = receipt_mint,
        associated_token::authority = beneficiary,
    )]
    pub beneficiary_receipt_ata: Account<'info, TokenAccount>,

    /// CHECK: Created by Metaplex via CPI; validated by the token metadata program.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: Created by Metaplex via CPI; validated by the token metadata program.
    #[account(mut)]
    pub master_edition: UncheckedAccount<'info>,

    pub token_metadata_program: Program<'info, Metadata>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<MintReceipt>) -> Result<()> {
    let escrow = &ctx.accounts.escrow_state;

    // Verify receipt hasn't been minted yet
    require!(
        escrow.receipt_mint.is_none(),
        EscrowError::ReceiptAlreadyMinted
    );

    // Status gate: only Active state allowed (receipt = right to receive funds)
    require!(
        escrow.status == EscrowStatus::Active,
        EscrowError::EscrowNotActive
    );

    // Must not be expired
    let clock = Clock::get()?;
    require!(clock.unix_timestamp <= escrow.expires_at, EscrowError::EscrowExpired);

    // Build escrow PDA signer seeds
    let seed_bytes = escrow.seed.to_le_bytes();
    let bump = [escrow.bump];
    let maker_key = escrow.maker;
    let inner = escrow_seeds(&maker_key, &seed_bytes, &bump);
    let signer_seeds: &[&[&[u8]]] = &[&inner];

    // Mint exactly 1 NFT token to beneficiary
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.receipt_mint.to_account_info(),
                to: ctx.accounts.beneficiary_receipt_ata.to_account_info(),
                authority: ctx.accounts.escrow_state.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // Create metadata account
    let escrow_key = ctx.accounts.escrow_state.key();
    let name = format!("Escrow Receipt #{}", &escrow_key.to_string()[..8]);

    let data = DataV2 {
        name,
        symbol: "RCPT".to_string(),
        uri: String::new(),
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.receipt_mint.to_account_info(),
                mint_authority: ctx.accounts.escrow_state.to_account_info(),
                payer: ctx.accounts.beneficiary.to_account_info(),
                update_authority: ctx.accounts.escrow_state.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        data,
        false,  // is_mutable: false — metadata is immutable after creation
        true,
        None,
    )?;

    // Create master edition (max_supply = 0 → true NFT)
    create_master_edition_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMasterEditionV3 {
                edition: ctx.accounts.master_edition.to_account_info(),
                mint: ctx.accounts.receipt_mint.to_account_info(),
                update_authority: ctx.accounts.escrow_state.to_account_info(),
                mint_authority: ctx.accounts.escrow_state.to_account_info(),
                payer: ctx.accounts.beneficiary.to_account_info(),
                metadata: ctx.accounts.metadata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        Some(0),
    )?;

    // Update escrow state with receipt mint
    let escrow = &mut ctx.accounts.escrow_state;
    escrow.receipt_mint = Some(ctx.accounts.receipt_mint.key());

    emit!(ReceiptMinted {
        escrow: ctx.accounts.escrow_state.key(),
        mint: ctx.accounts.receipt_mint.key(),
        beneficiary: ctx.accounts.beneficiary.key(),
    });

    Ok(())
}
