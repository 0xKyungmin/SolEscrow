/**
 * Devnet Demo Script
 *
 * Runs a full escrow lifecycle on Devnet:
 *   1. Create SPL token mint
 *   2. Create ATAs + mint tokens
 *   3. Initialize escrow config
 *   4. Create escrow with 2 milestones
 *   5. Approve milestone #0
 *   6. Release milestone #0
 *   7. Cancel escrow (refund remaining)
 *   8. Print all transaction links
 *
 * Usage: npx ts-node scripts/devnet-demo.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import {
  PROGRAM_ID,
  findEscrowConfigPDA,
  findEscrowPDA,
  createDescriptionHash,
} from "../client/pda";

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://api.devnet.solana.com";
const EXPLORER_BASE = "https://explorer.solana.com/tx";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function explorerLink(sig: string): string {
  return `${EXPLORER_BASE}/${sig}?cluster=devnet`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  Escrow Program — Devnet Demo");
  console.log("=".repeat(60));
  console.log();

  // Load wallet
  const walletPath = path.join(
    process.env.HOME ?? "~",
    ".config",
    "solana",
    "id.json"
  );
  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const maker = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  // Create a taker keypair
  const taker = Keypair.generate();

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(maker);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load IDL (Anchor 0.32 format: program ID is embedded in the IDL)
  const idlPath = path.resolve(__dirname, "../target/idl/escrow.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new anchor.Program(idl, provider);

  const txLinks: { step: string; sig: string; link: string }[] = [];

  console.log(`Maker:   ${maker.publicKey.toBase58()}`);
  console.log(`Taker:   ${taker.publicKey.toBase58()}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log();

  // ── Step 1: Create SPL Token Mint ────────────────────────────────────────

  console.log("Step 1: Creating SPL token mint...");
  const mint = await createMint(
    connection,
    maker,
    maker.publicKey,
    null,
    6 // 6 decimals
  );
  console.log(`  Mint: ${mint.toBase58()}`);

  // ── Step 2: Create ATAs and mint tokens ──────────────────────────────────

  console.log("Step 2: Creating ATAs and minting tokens...");

  const makerATA = await getOrCreateAssociatedTokenAccount(
    connection,
    maker,
    mint,
    maker.publicKey
  );
  console.log(`  Maker ATA: ${makerATA.address.toBase58()}`);

  const takerATA = await getOrCreateAssociatedTokenAccount(
    connection,
    maker, // maker pays for taker's ATA
    mint,
    taker.publicKey
  );
  console.log(`  Taker ATA: ${takerATA.address.toBase58()}`);

  // Mint 1000 tokens (1000 * 10^6) to maker
  const mintAmount = 1_000_000_000; // 1000 tokens with 6 decimals
  await mintTo(connection, maker, mint, makerATA.address, maker, mintAmount);
  console.log(`  Minted ${mintAmount / 1_000_000} tokens to maker`);
  console.log();

  // ── Step 3: Initialize Escrow Config ─────────────────────────────────────

  console.log("Step 3: Initializing escrow config...");
  const [configPDA] = findEscrowConfigPDA();

  let configExists = false;
  try {
    await program.account.escrowConfig.fetch(configPDA);
    configExists = true;
    console.log("  Config already exists, skipping...");
  } catch {
    // Config doesn't exist, create it
  }

  if (!configExists) {
    const feeBps = 250; // 2.5%
    const disputeTimeout = new BN(86400); // 1 day

    const initConfigSig = await program.methods
      .initializeConfig(feeBps, disputeTimeout)
      .accounts({
        authority: maker.publicKey,
        escrowConfig: configPDA,
        feeCollector: maker.publicKey, // maker is also fee collector for demo
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    txLinks.push({
      step: "Initialize Config",
      sig: initConfigSig,
      link: explorerLink(initConfigSig),
    });
    console.log(`  Config PDA: ${configPDA.toBase58()}`);
    console.log(`  Fee: 2.5% | Dispute timeout: 86400s`);
    console.log(`  tx: ${initConfigSig}`);
  }
  console.log();

  // ── Step 4: Create Escrow ────────────────────────────────────────────────

  console.log("Step 4: Creating escrow with 2 milestones...");
  const seed = new BN(Date.now());
  const escrowAmount = new BN(100_000_000); // 100 tokens

  const [escrowPDA] = findEscrowPDA(maker.publicKey, seed);

  const vaultATA = await anchor.utils.token.associatedAddress({
    mint,
    owner: escrowPDA,
  });

  const expiresAt = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  const milestones = [
    {
      amount: new BN(60_000_000), // 60 tokens
      descriptionHash: createDescriptionHash("Design and implement smart contract"),
    },
    {
      amount: new BN(40_000_000), // 40 tokens
      descriptionHash: createDescriptionHash("Write tests and documentation"),
    },
  ];

  const createSig = await program.methods
    .createEscrow(seed, escrowAmount, milestones, expiresAt)
    .accounts({
      maker: maker.publicKey,
      taker: taker.publicKey,
      mint,
      escrowState: escrowPDA,
      vault: vaultATA,
      makerTokenAccount: makerATA.address,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  txLinks.push({
    step: "Create Escrow",
    sig: createSig,
    link: explorerLink(createSig),
  });
  console.log(`  Escrow PDA: ${escrowPDA.toBase58()}`);
  console.log(`  Vault:      ${vaultATA.toBase58()}`);
  console.log(`  Amount:     100 tokens (2 milestones: 60 + 40)`);
  console.log(`  tx: ${createSig}`);
  console.log();

  // ── Step 5: Approve Milestone #0 ────────────────────────────────────────

  console.log("Step 5: Maker approves milestone #0...");
  await sleep(1000); // wait for confirmation

  const approveSig = await program.methods
    .approveMilestone(0)
    .accounts({
      maker: maker.publicKey,
      escrowState: escrowPDA,
    })
    .rpc();

  txLinks.push({
    step: "Approve Milestone #0",
    sig: approveSig,
    link: explorerLink(approveSig),
  });
  console.log(`  tx: ${approveSig}`);
  console.log();

  // ── Step 6: Release Milestone #0 ────────────────────────────────────────

  console.log("Step 6: Release milestone #0 (60 tokens to taker)...");
  await sleep(1000);

  // fee collector ATA (maker is fee collector in this demo)
  const feeCollectorATA = makerATA.address;

  const releaseSig = await program.methods
    .releaseMilestone(0)
    .accounts({
      payer: maker.publicKey,
      escrowState: escrowPDA,
      escrowConfig: configPDA,
      mint,
      vault: vaultATA,
      beneficiaryTokenAccount: takerATA.address,
      feeCollectorTokenAccount: feeCollectorATA,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  txLinks.push({
    step: "Release Milestone #0",
    sig: releaseSig,
    link: explorerLink(releaseSig),
  });
  console.log(`  tx: ${releaseSig}`);
  console.log();

  // ── Step 7: Cancel remaining (milestone #1 refunded) ────────────────────

  console.log("Step 7: Maker cancels escrow (refund milestone #1)...");
  await sleep(1000);

  const cancelSig = await program.methods
    .cancelEscrow()
    .accounts({
      maker: maker.publicKey,
      escrowState: escrowPDA,
      mint,
      vault: vaultATA,
      makerTokenAccount: makerATA.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  txLinks.push({
    step: "Cancel Escrow",
    sig: cancelSig,
    link: explorerLink(cancelSig),
  });
  console.log(`  tx: ${cancelSig}`);
  console.log();

  // ── Step 8: Fetch final state ───────────────────────────────────────────

  console.log("Step 8: Final escrow state...");
  await sleep(1000);
  const finalState = await program.account.escrowState.fetch(escrowPDA);
  console.log(`  Status:          ${Object.keys(finalState.status)[0]}`);
  console.log(`  Released Amount: ${finalState.releasedAmount.toString()}`);
  console.log(`  Milestones:`);
  (finalState.milestones as any[]).forEach((m: any, i: number) => {
    console.log(
      `    [${i}] amount=${m.amount.toString()} status=${Object.keys(m.status)[0]}`
    );
  });
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("  Transaction Links (Solana Explorer — Devnet)");
  console.log("=".repeat(60));
  console.log();
  for (const tx of txLinks) {
    console.log(`${tx.step}:`);
    console.log(`  ${tx.link}`);
    console.log();
  }

  console.log("=".repeat(60));
  console.log("  Accounts");
  console.log("=".repeat(60));
  console.log();
  console.log(`Program:      ${PROGRAM_ID.toBase58()}`);
  console.log(`Config PDA:   ${configPDA.toBase58()}`);
  console.log(`Escrow PDA:   ${escrowPDA.toBase58()}`);
  console.log(`Vault ATA:    ${vaultATA.toBase58()}`);
  console.log(`Mint:         ${mint.toBase58()}`);
  console.log(`Maker:        ${maker.publicKey.toBase58()}`);
  console.log(`Taker:        ${taker.publicKey.toBase58()}`);
  console.log();
  console.log("Demo complete!");
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
