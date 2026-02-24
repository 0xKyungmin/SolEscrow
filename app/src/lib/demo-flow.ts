import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, web3 } from "@coral-xyz/anchor";
import {
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import idlJson from "../idl/escrow.json";

/**
 * Minimal Wallet implementation to avoid the webpack ESM warning
 * about `Wallet` not being exported from `@coral-xyz/anchor`.
 */
class KeypairWallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    for (const tx of txs) {
      if (tx instanceof Transaction) {
        tx.partialSign(this.payer);
      }
    }
    return txs;
  }
}

import {
  PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  findConfigPDA,
  findEscrowPDA,
  findReceiptMintPDA,
  findMetadataPDA,
  findMasterEditionPDA,
} from "./pda";

/* ── Constants ── */
const DEVNET_URL = "https://api.devnet.solana.com";

/** Delay helper for smooth UI animations between steps */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Public types ── */
export interface StepResult {
  step: number; // 0-3
  txSignature: string;
}

export type SetupCallback = (msg: string) => void;
export type StepCallback = (result: StepResult) => void;
export type ErrorCallback = (error: string) => void;

/* ── Load demo keypair from env ── */
function loadDemoKeypair(): Keypair {
  const raw = process.env.NEXT_PUBLIC_DEMO_KEYPAIR;
  if (!raw) throw new Error("NEXT_PUBLIC_DEMO_KEYPAIR not set in .env.local");
  const bytes = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}


/* ── Create an Anchor program instance typed loosely to avoid TS2589 ── */
function createProgram(
  provider: AnchorProvider
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idlJson as any, provider);
}

/* ── Main demo flow ── */
export async function runDemoFlow(
  onSetup: SetupCallback,
  onStep: StepCallback,
  onError: ErrorCallback
): Promise<void> {
  try {
    const connection = new Connection(DEVNET_URL, "confirmed");

    // ── Setup: Load buyer (maker) keypair, generate fresh seller (taker) ──
    const buyer = loadDemoKeypair();
    const seller = Keypair.generate();

    // Fund seller with SOL from buyer for gas fees
    onSetup("Funding seller account with SOL for gas...");
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: buyer.publicKey,
        toPubkey: seller.publicKey,
        lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
      })
    );
    fundTx.feePayer = buyer.publicKey;
    fundTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    fundTx.sign(buyer);
    const fundSig = await connection.sendRawTransaction(fundTx.serialize());
    await connection.confirmTransaction(fundSig, "confirmed");

    // Create SPL token mint (6 decimals, like USDC)
    onSetup("Creating test token mint...");
    const mint = await createMint(
      connection,
      buyer,
      buyer.publicKey,
      null,
      6
    );

    // Create buyer ATA and mint 1000 tokens
    onSetup("Minting 1,000 test tokens to buyer...");
    const buyerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      mint,
      buyer.publicKey
    );
    await mintTo(
      connection,
      buyer,
      mint,
      buyerAta.address,
      buyer.publicKey,
      1_000_000_000 // 1000 tokens (6 decimals)
    );

    // Create seller ATA
    onSetup("Creating seller token account...");
    const sellerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer, // buyer pays for ATA creation
      mint,
      seller.publicKey
    );

    // Setup Anchor providers + programs for both buyer and seller
    onSetup("Connecting to escrow program...");
    const buyerWallet = new KeypairWallet(buyer);
    const buyerProvider = new AnchorProvider(connection, buyerWallet, {
      commitment: "confirmed",
    });
    const buyerProgram = createProgram(buyerProvider);

    const sellerWallet = new KeypairWallet(seller);
    const sellerProvider = new AnchorProvider(connection, sellerWallet, {
      commitment: "confirmed",
    });
    const sellerProgram = createProgram(sellerProvider);

    // Check/init escrow config PDA
    onSetup("Checking escrow config...");
    const configPDA = findConfigPDA();
    const configInfo = await connection.getAccountInfo(configPDA);

    if (!configInfo) {
      onSetup("Initializing escrow config...");
      await buyerProgram.methods
        .initializeConfig(50, new BN(86400))
        .accounts({
          authority: buyer.publicKey,
          escrowConfig: configPDA,
          feeCollector: buyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Fetch config to get fee_collector, create its ATA
    const config = await buyerProgram.account.escrowConfig.fetch(configPDA);
    const feeCollector = config.feeCollector as PublicKey;
    const feeCollectorAta = await getOrCreateAssociatedTokenAccount(
      connection,
      buyer,
      mint,
      feeCollector
    );

    onSetup("Ready! Executing transactions...");

    // ═══════════════════════════════════════════════════
    // STEP 0: Create Escrow (Buyer locks payment)
    // ═══════════════════════════════════════════════════
    const seed = new BN(Date.now());
    const escrowPDA = findEscrowPDA(buyer.publicKey, seed);
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);
    const amount = new BN(1_000_000); // 1 token (6 decimals)

    const milestones = [
      { amount: new BN(1_000_000), descriptionHash: Array(32).fill(1) },
    ];

    const expiresAt = new BN(Math.floor(Date.now() / 1000) + 86400);

    const tx0: string = await buyerProgram.methods
      .createEscrow(seed, amount, milestones, expiresAt)
      .accounts({
        maker: buyer.publicKey,
        taker: seller.publicKey,
        escrowConfig: configPDA,
        mint,
        escrowState: escrowPDA,
        vault,
        makerTokenAccount: buyerAta.address,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    onStep({ step: 0, txSignature: tx0 });
    await delay(1500);

    // ═══════════════════════════════════════════════════
    // STEP 1: Mint NFT Receipt (Seller mints tradeable receivable)
    // ═══════════════════════════════════════════════════
    const receiptMint = findReceiptMintPDA(escrowPDA);
    const metadata = findMetadataPDA(receiptMint);
    const masterEdition = findMasterEditionPDA(receiptMint);
    const beneficiaryReceiptAta = getAssociatedTokenAddressSync(
      receiptMint,
      seller.publicKey
    );

    const tx1: string = await sellerProgram.methods
      .mintReceipt()
      .accounts({
        beneficiary: seller.publicKey,
        escrowState: escrowPDA,
        receiptMint,
        beneficiaryReceiptAta,
        metadata,
        masterEdition,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    onStep({ step: 1, txSignature: tx1 });
    await delay(1500);

    // ═══════════════════════════════════════════════════
    // STEP 2: Approve Delivery (Buyer confirms work done)
    // ═══════════════════════════════════════════════════
    const tx2: string = await buyerProgram.methods
      .approveMilestone(0)
      .accounts({
        maker: buyer.publicKey,
        escrowState: escrowPDA,
      })
      .rpc();

    onStep({ step: 2, txSignature: tx2 });
    await delay(1500);

    // ═══════════════════════════════════════════════════
    // STEP 3: Release Payment (Funds sent to seller)
    // ═══════════════════════════════════════════════════
    const tx3: string = await buyerProgram.methods
      .releaseMilestone(0)
      .accounts({
        payer: buyer.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        beneficiaryTokenAccount: sellerAta.address,
        feeCollectorTokenAccount: feeCollectorAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: beneficiaryReceiptAta,
          isWritable: false,
          isSigner: false,
        },
      ])
      .rpc();

    onStep({ step: 3, txSignature: tx3 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(msg);
  }
}
