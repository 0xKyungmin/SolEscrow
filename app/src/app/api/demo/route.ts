import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
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
import type { PublicKey, VersionedTransaction } from "@solana/web3.js";
import idlJson from "../../../idl/escrow.json";
import {
  TOKEN_METADATA_PROGRAM_ID,
  findConfigPDA,
  findEscrowPDA,
  findReceiptMintPDA,
  findMetadataPDA,
  findMasterEditionPDA,
} from "../../../lib/pda";

/* Minimal wallet for AnchorProvider (server-side) */
class KeypairWallet {
  constructor(readonly payer: Keypair) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    for (const tx of txs) {
      if (tx instanceof Transaction) tx.partialSign(this.payer);
    }
    return txs;
  }
}

const DEVNET_URL = "https://api.devnet.solana.com";

/**
 * Subclass Connection to replace WebSocket-based confirmTransaction
 * with HTTP polling (getSignatureStatuses).
 * Vercel serverless does not support persistent WebSocket connections,
 * causing "t.mask is not a function" errors from the ws package.
 */
class PollingConnection extends Connection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async confirmTransaction(...args: any[]): Promise<any> {
    const strategy = args[0];
    const signature =
      typeof strategy === "string" ? strategy : strategy.signature;

    for (let i = 0; i < 60; i++) {
      const { value, context } = await this.getSignatureStatuses([signature]);
      const status = value[0];
      if (status) {
        if (status.err) {
          return { context, value: { err: status.err } };
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return { context, value: { err: null } };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Transaction confirmation timeout: ${signature}`);
  }
}

function loadDemoKeypair(): Keypair {
  const raw = process.env.DEMO_KEYPAIR;
  if (!raw) throw new Error("DEMO_KEYPAIR not set in .env.local");
  const bytes = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProgram(provider: AnchorProvider): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idlJson as any, provider);
}

/** Send a single NDJSON line */
function emit(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>
) {
  controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
}

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const connection = new PollingConnection(DEVNET_URL, "confirmed");
        const buyer = loadDemoKeypair();
        const seller = Keypair.generate();

        emit(controller, encoder, {
          type: "setup",
          msg: "Funding accounts...",
        });

        // Fund seller
        const fundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: buyer.publicKey,
            toPubkey: seller.publicKey,
            lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
          })
        );
        fundTx.feePayer = buyer.publicKey;
        fundTx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;
        fundTx.sign(buyer);
        const fundSig = await connection.sendRawTransaction(fundTx.serialize());
        await connection.confirmTransaction(fundSig, "confirmed");

        emit(controller, encoder, {
          type: "setup",
          msg: "Creating token mint...",
        });

        // Create SPL token mint
        const mint = await createMint(
          connection,
          buyer,
          buyer.publicKey,
          null,
          6
        );

        emit(controller, encoder, {
          type: "setup",
          msg: "Setting up token accounts...",
        });

        // Parallelize: create all ATAs simultaneously
        const [buyerAta, sellerAta] = await Promise.all([
          getOrCreateAssociatedTokenAccount(
            connection,
            buyer,
            mint,
            buyer.publicKey
          ),
          getOrCreateAssociatedTokenAccount(
            connection,
            buyer,
            mint,
            seller.publicKey
          ),
        ]);

        // Mint tokens to buyer
        await mintTo(
          connection,
          buyer,
          mint,
          buyerAta.address,
          buyer.publicKey,
          1_000_000_000
        );

        // Setup Anchor
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

        // Check/init config
        const configPDA = findConfigPDA();
        const configInfo = await connection.getAccountInfo(configPDA);
        if (!configInfo) {
          emit(controller, encoder, {
            type: "setup",
            msg: "Initializing escrow config...",
          });
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

        const config = await buyerProgram.account.escrowConfig.fetch(configPDA);
        const feeCollector = config.feeCollector as PublicKey;
        const feeCollectorAta = await getOrCreateAssociatedTokenAccount(
          connection,
          buyer,
          mint,
          feeCollector
        );

        // ── Step 0: Create Escrow ──
        emit(controller, encoder, {
          type: "setup",
          msg: "Creating escrow...",
        });

        const seed = new BN(Date.now());
        const escrowPDA = findEscrowPDA(buyer.publicKey, seed);
        const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);
        const amount = new BN(1_000_000);
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

        emit(controller, encoder, {
          type: "step",
          step: 0,
          txSignature: tx0,
        });

        // ── Step 1: Mint Receipt NFT ──
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

        emit(controller, encoder, {
          type: "step",
          step: 1,
          txSignature: tx1,
        });

        // ── Step 2: Approve Milestone ──
        const tx2: string = await buyerProgram.methods
          .approveMilestone(0)
          .accounts({
            maker: buyer.publicKey,
            escrowState: escrowPDA,
          })
          .rpc();

        emit(controller, encoder, {
          type: "step",
          step: 2,
          txSignature: tx2,
        });

        // ── Step 3: Release Milestone ──
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

        emit(controller, encoder, {
          type: "step",
          step: 3,
          txSignature: tx3,
        });

        emit(controller, encoder, { type: "done" });
        controller.close();
      } catch (err: unknown) {
        console.error("Demo API error:", err);
        emit(controller, encoder, {
          type: "error",
          error: "Demo transaction failed. Please try again later.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
