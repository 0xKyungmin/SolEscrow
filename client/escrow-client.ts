import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionSignature,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  findEscrowConfigPDA,
  findEscrowPDA,
  findReceiptMintPDA,
  findMetadataPDA,
  findMasterEditionPDA,
  TOKEN_METADATA_PROGRAM_ID,
} from "./pda";

// ─── IDL type (minimal inline to avoid needing target/idl at runtime) ─────────

// We use `any` for the Program type so consumers can pass any loaded IDL.
// The Anchor IDL is loaded externally and passed to the constructor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnchorProgram = Program<any>;
type AnchorProvider = anchor.AnchorProvider;

// ─── Account state types ──────────────────────────────────────────────────────

export interface MilestoneInput {
  amount: BN;
  descriptionHash: number[]; // [u8; 32]
}

export type EscrowStatus =
  | { active: Record<string, never> }
  | { completed: Record<string, never> }
  | { disputed: Record<string, never> }
  | { cancelled: Record<string, never> }
  | { expired: Record<string, never> };

export type MilestoneStatus =
  | { pending: Record<string, never> }
  | { approved: Record<string, never> }
  | { released: Record<string, never> }
  | { cancelled: Record<string, never> };

export interface Milestone {
  amount: BN;
  descriptionHash: number[];
  status: MilestoneStatus;
}

export type DisputeResolution =
  | { makerWins: Record<string, never> }
  | { takerWins: Record<string, never> }
  | { split: { makerBps: number } };

export interface Dispute {
  initiator: PublicKey;
  reasonHash: number[];
  initiatedAt: BN;
  timeout: BN;
  resolution: DisputeResolution | null;
}

export interface EscrowState {
  maker: PublicKey;
  taker: PublicKey;
  beneficiary: PublicKey;
  mint: PublicKey;
  amount: BN;
  releasedAmount: BN;
  refundedAmount: BN;
  seed: BN;
  status: EscrowStatus;
  milestones: Milestone[];
  createdAt: BN;
  expiresAt: BN;
  dispute: Dispute | null;
  feeBpsAtCreation: number;
  bump: number;
  receiptMint: PublicKey | null;
}

export interface EscrowConfig {
  authority: PublicKey;
  feeBps: number;
  feeCollector: PublicKey;
  disputeTimeout: BN;
  bump: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class EscrowClient {
  readonly program: AnchorProgram;
  readonly provider: AnchorProvider;

  constructor(program: AnchorProgram, provider: AnchorProvider) {
    this.program = program;
    this.provider = provider;
  }

  // ── Instructions ────────────────────────────────────────────────────────────

  /**
   * Initialize the global escrow config. Caller becomes the authority.
   */
  async initializeConfig(
    feeBps: number,
    disputeTimeout: BN,
    feeCollector: PublicKey
  ): Promise<TransactionSignature> {
    const [escrowConfigPDA] = findEscrowConfigPDA(this.program.programId);

    return this.program.methods
      .initializeConfig(feeBps, disputeTimeout)
      .accounts({
        authority: this.provider.wallet.publicKey,
        escrowConfig: escrowConfigPDA,
        feeCollector,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Create a new escrow. Caller is the maker.
   * milestones: array of { amount: BN, descriptionHash: number[] (32 bytes) }
   */
  async createEscrow(
    taker: PublicKey,
    mint: PublicKey,
    seed: BN,
    amount: BN,
    milestones: MilestoneInput[],
    expiresAt: BN
  ): Promise<TransactionSignature> {
    const maker = this.provider.wallet.publicKey;
    const [escrowStatePDA] = findEscrowPDA(maker, seed, this.program.programId);
    const vault = getAssociatedTokenAddressSync(mint, escrowStatePDA, true);
    const makerTokenAccount = getAssociatedTokenAddressSync(mint, maker);

    return this.program.methods
      .createEscrow(seed, amount, milestones, expiresAt)
      .accounts({
        maker,
        taker,
        mint,
        escrowState: escrowStatePDA,
        vault,
        makerTokenAccount,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Approve a milestone. Caller must be the maker.
   */
  async approveMilestone(
    escrowPDA: PublicKey,
    milestoneIndex: number
  ): Promise<TransactionSignature> {
    return this.program.methods
      .approveMilestone(milestoneIndex)
      .accounts({
        maker: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
      })
      .rpc();
  }

  /**
   * Release a milestone payment to the beneficiary. Anyone can crank this after approval.
   */
  async releaseMilestone(
    escrowPDA: PublicKey,
    milestoneIndex: number,
    beneficiaryTokenAccount: PublicKey,
    feeCollectorTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    // Fetch escrow to get mint
    const escrow = await this.fetchEscrow(escrowPDA);
    const mint = escrow.mint;
    const [configPDA] = findEscrowConfigPDA(this.program.programId);
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);

    return this.program.methods
      .releaseMilestone(milestoneIndex)
      .accounts({
        payer: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        beneficiaryTokenAccount,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Initiate a dispute. Caller must be maker, taker, or beneficiary.
   * reasonHash: 32-byte array (e.g. sha256 of the reason text)
   */
  async initiateDispute(
    escrowPDA: PublicKey,
    reasonHash: number[]
  ): Promise<TransactionSignature> {
    const [configPDA] = findEscrowConfigPDA(this.program.programId);

    return this.program.methods
      .initiateDispute(reasonHash)
      .accounts({
        initiator: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
      })
      .rpc();
  }

  /**
   * Resolve a dispute. Caller must be the config authority.
   */
  async resolveDispute(
    escrowPDA: PublicKey,
    resolution: DisputeResolution,
    makerTokenAccount: PublicKey,
    beneficiaryTokenAccount: PublicKey,
    feeCollectorTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const escrow = await this.fetchEscrow(escrowPDA);
    const mint = escrow.mint;
    const [configPDA] = findEscrowConfigPDA(this.program.programId);
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);

    return this.program.methods
      .resolveDispute(resolution)
      .accounts({
        authority: this.provider.wallet.publicKey,
        escrowConfig: configPDA,
        escrowState: escrowPDA,
        mint,
        vault,
        makerTokenAccount,
        beneficiaryTokenAccount,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Cancel an active escrow. Caller must be the maker.
   */
  async cancelEscrow(
    escrowPDA: PublicKey,
    makerTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const escrow = await this.fetchEscrow(escrowPDA);
    const mint = escrow.mint;
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);

    return this.program.methods
      .cancelEscrow()
      .accounts({
        maker: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        mint,
        vault,
        makerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Claim funds from an expired escrow back to maker. Permissionless crank.
   */
  async claimExpired(
    escrowPDA: PublicKey,
    makerTokenAccount: PublicKey,
    beneficiaryTokenAccount: PublicKey,
    feeCollectorTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const escrow = await this.fetchEscrow(escrowPDA);
    const mint = escrow.mint;
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);
    const [configPDA] = findEscrowConfigPDA(this.program.programId);

    return this.program.methods
      .claimExpired()
      .accounts({
        payer: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        makerTokenAccount,
        beneficiaryTokenAccount,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /**
   * Transfer payment claim to a new beneficiary. Caller must be the current beneficiary.
   */
  async transferClaim(
    escrowPDA: PublicKey,
    newBeneficiary: PublicKey
  ): Promise<TransactionSignature> {
    return this.program.methods
      .transferClaim()
      .accounts({
        beneficiary: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        newBeneficiary,
      })
      .rpc();
  }

  /**
   * Mint a Receipt NFT for an escrow. Caller must be the current beneficiary.
   * Only works on Active (non-expired) escrows.
   */
  async mintReceipt(
    escrowPDA: PublicKey
  ): Promise<TransactionSignature> {
    const beneficiary = this.provider.wallet.publicKey;
    const [receiptMint] = findReceiptMintPDA(escrowPDA, this.program.programId);
    const [metadata] = findMetadataPDA(receiptMint);
    const [masterEdition] = findMasterEditionPDA(receiptMint);
    const beneficiaryReceiptAta = getAssociatedTokenAddressSync(receiptMint, beneficiary);

    return this.program.methods
      .mintReceipt()
      .accounts({
        beneficiary,
        escrowState: escrowPDA,
        receiptMint,
        beneficiaryReceiptAta,
        metadata,
        masterEdition,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  }

  /**
   * Sync the escrow beneficiary to the current Receipt NFT holder.
   * Permissionless — anyone can call this after the NFT has been transferred.
   */
  async syncBeneficiary(
    escrowPDA: PublicKey,
    receiptTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const [receiptMint] = findReceiptMintPDA(escrowPDA, this.program.programId);

    return this.program.methods
      .syncBeneficiary()
      .accounts({
        payer: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        receiptMint,
        receiptTokenAccount,
      })
      .rpc();
  }

  /**
   * Revoke a burned Receipt NFT. Permissionless — anyone can call after the receipt is burned (supply == 0).
   * This clears receipt_mint, re-enabling transfer_claim.
   */
  async revokeReceipt(
    escrowPDA: PublicKey
  ): Promise<TransactionSignature> {
    const [receiptMint] = findReceiptMintPDA(escrowPDA, this.program.programId);

    return this.program.methods
      .revokeReceipt()
      .accounts({
        payer: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        receiptMint,
      })
      .rpc();
  }

  /**
   * Update the global escrow config. Caller must be the current authority.
   */
  async updateConfig(
    feeCollector: PublicKey,
    newAuthority?: PublicKey,
    feeBps?: number,
    disputeTimeout?: BN
  ): Promise<TransactionSignature> {
    const [configPDA] = findEscrowConfigPDA(this.program.programId);

    return this.program.methods
      .updateConfig(
        newAuthority ?? null,
        feeBps ?? null,
        disputeTimeout ?? null
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        escrowConfig: configPDA,
        feeCollector,
      })
      .rpc();
  }

  /**
   * Close a terminal escrow account and reclaim rent. Caller must be the maker.
   * Sweeps any dust in the vault back to maker before closing.
   */
  async closeEscrow(
    escrowPDA: PublicKey,
    makerTokenAccount: PublicKey
  ): Promise<TransactionSignature> {
    const escrow = await this.fetchEscrow(escrowPDA);
    const mint = escrow.mint;
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);

    return this.program.methods
      .closeEscrow()
      .accounts({
        maker: this.provider.wallet.publicKey,
        escrowState: escrowPDA,
        mint,
        vault,
        makerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ── Fetch helpers ────────────────────────────────────────────────────────────

  async fetchEscrow(escrowPDA: PublicKey): Promise<EscrowState> {
    const raw = await this.program.account.escrowState.fetch(escrowPDA);
    return raw as EscrowState;
  }

  async fetchConfig(): Promise<EscrowConfig> {
    const [configPDA] = findEscrowConfigPDA(this.program.programId);
    const raw = await this.program.account.escrowConfig.fetch(configPDA);
    return raw as EscrowConfig;
  }
}
