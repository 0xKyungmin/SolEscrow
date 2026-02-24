#!/usr/bin/env ts-node
/**
 * Escrow CLI
 *
 * Usage: npx ts-node client/cli.ts <command> [options]
 *
 * Commands:
 *   init-config   --fee-bps <n> --dispute-timeout <n> --fee-collector <pubkey>
 *   create-escrow --taker <pubkey> --mint <pubkey> --amount <n> --milestones <json> --expires-in <seconds>
 *   approve       --escrow <pubkey> --milestone <n>
 *   release       --escrow <pubkey> --milestone <n> [--taker-ata <pubkey>] [--fee-ata <pubkey>]
 *   dispute       --escrow <pubkey> --reason <text>
 *   resolve       --escrow <pubkey> --resolution <maker-wins|taker-wins|split:BPS> [--maker-ata <pubkey>] [--taker-ata <pubkey>] [--fee-ata <pubkey>]
 *   cancel        --escrow <pubkey> [--maker-ata <pubkey>]
 *   claim-expired --escrow <pubkey> [--maker-ata <pubkey>]
 *   transfer-claim --escrow <pubkey> --new-beneficiary <pubkey>
 *   mint-receipt  --escrow <pubkey>
 *   sync-beneficiary --escrow <pubkey> --receipt-token-account <pubkey>
 *   revoke-receipt --escrow <pubkey>
 *   update-config [--fee-bps <n>] [--dispute-timeout <n>] [--fee-collector <pubkey>] [--new-authority <pubkey>]
 *   close-escrow  --escrow <pubkey> [--maker-ata <pubkey>]
 *   status        --escrow <pubkey>
 *
 * Environment:
 *   ANCHOR_PROVIDER_URL  RPC endpoint (default: https://api.devnet.solana.com)
 *   ANCHOR_WALLET        Path to wallet keypair JSON (default: ~/.config/solana/id.json)
 */

import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { EscrowClient, DisputeResolution, MilestoneInput } from "./escrow-client";
import { findEscrowPDA, findReceiptMintPDA } from "./pda";

// ─── IDL ─────────────────────────────────────────────────────────────────────

const IDL_PATH = path.resolve(__dirname, "../target/idl/escrow.json");

function loadIdl(): anchor.Idl {
  if (!fs.existsSync(IDL_PATH)) {
    die(
      `IDL not found at ${IDL_PATH}.\n` +
        `Run "anchor build" first to generate the IDL.`
    );
  }
  return JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
}

// ─── Arg parsing helpers ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        result[key] = "true";
      } else {
        result[key] = value;
        i++;
      }
    }
    i++;
  }
  return result;
}

function requireArg(args: Record<string, string>, key: string): string {
  const val = args[key];
  if (!val) die(`Missing required argument: --${key}`);
  return val;
}

function optionalArg(
  args: Record<string, string>,
  key: string
): string | undefined {
  return args[key];
}

function requirePubkey(args: Record<string, string>, key: string): PublicKey {
  const raw = requireArg(args, key);
  try {
    return new PublicKey(raw);
  } catch {
    die(`Invalid public key for --${key}: ${raw}`);
  }
}

function optionalPubkey(
  args: Record<string, string>,
  key: string
): PublicKey | undefined {
  const raw = optionalArg(args, key);
  if (!raw) return undefined;
  try {
    return new PublicKey(raw);
  } catch {
    die(`Invalid public key for --${key}: ${raw}`);
  }
}

function requireNumber(args: Record<string, string>, key: string): number {
  const raw = requireArg(args, key);
  const n = Number(raw);
  if (isNaN(n)) die(`--${key} must be a number, got: ${raw}`);
  return n;
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// ─── Provider setup ───────────────────────────────────────────────────────────

function buildProvider(): anchor.AnchorProvider {
  const rpcUrl =
    process.env.ANCHOR_PROVIDER_URL ?? "https://api.devnet.solana.com";

  const walletPath =
    process.env.ANCHOR_WALLET ??
    path.join(process.env.HOME ?? "~", ".config", "solana", "id.json");

  if (!fs.existsSync(walletPath)) {
    die(
      `Wallet file not found: ${walletPath}\n` +
        `Set ANCHOR_WALLET env var or run "solana-keygen new".`
    );
  }

  const keypairData = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(rpcUrl, "confirmed");
  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function statusLabel(status: object): string {
  const keys = Object.keys(status);
  return keys.length > 0 ? keys[0] : "unknown";
}


function formatEscrowState(escrow: Awaited<ReturnType<EscrowClient["fetchEscrow"]>>): void {
  console.log("\n=== Escrow State ===");
  console.log(`Maker:            ${escrow.maker.toBase58()}`);
  console.log(`Taker:            ${escrow.taker.toBase58()}`);
  console.log(`Beneficiary:      ${escrow.beneficiary.toBase58()}`);
  console.log(`Mint:             ${escrow.mint.toBase58()}`);
  console.log(`Amount:           ${escrow.amount.toString()}`);
  console.log(`Released:         ${escrow.releasedAmount.toString()}`);
  console.log(`Seed:             ${escrow.seed.toString()}`);
  console.log(`Status:           ${statusLabel(escrow.status)}`);
  console.log(`Created At:       ${new Date(escrow.createdAt.toNumber() * 1000).toISOString()}`);
  console.log(`Expires At:       ${new Date(escrow.expiresAt.toNumber() * 1000).toISOString()}`);
  console.log(`Bump:             ${escrow.bump}`);
  console.log(`\nMilestones (${escrow.milestones.length}):`);
  escrow.milestones.forEach((m, i) => {
    console.log(
      `  [${i}] amount=${m.amount.toString()} status=${statusLabel(m.status)}`
    );
  });
  if (escrow.dispute) {
    const d = escrow.dispute;
    console.log(`\nDispute:`);
    console.log(`  Initiator:    ${d.initiator.toBase58()}`);
    console.log(`  Initiated At: ${new Date(d.initiatedAt.toNumber() * 1000).toISOString()}`);
    if (d.resolution) {
      console.log(`  Resolution:   ${statusLabel(d.resolution)}`);
    } else {
      console.log(`  Resolution:   (pending)`);
    }
  }
  console.log("");
}

// ─── Dispute resolution parser ────────────────────────────────────────────────

function parseResolution(raw: string): DisputeResolution {
  if (raw === "maker-wins") return { makerWins: {} };
  if (raw === "taker-wins") return { takerWins: {} };
  if (raw.startsWith("split:")) {
    const bps = parseInt(raw.slice(6), 10);
    if (isNaN(bps) || bps < 0 || bps > 10000) {
      die(`split BPS must be 0-10000, got: ${raw.slice(6)}`);
    }
    return { split: { makerBps: bps } };
  }
  die(
    `Invalid --resolution value: "${raw}". ` +
      `Expected: maker-wins | taker-wins | split:<BPS>`
  );
}

// ─── Milestone JSON parser ────────────────────────────────────────────────────

interface RawMilestone {
  amount: number | string;
  description?: string;
  descriptionHash?: number[];
}

function parseMilestones(raw: string): MilestoneInput[] {
  let parsed: RawMilestone[];
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`--milestones must be valid JSON. Got: ${raw}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    die(`--milestones must be a non-empty JSON array.`);
  }
  return parsed.map((m, i) => {
    if (m.amount === undefined) die(`Milestone [${i}] missing "amount".`);
    const amount = new BN(String(m.amount));

    let descriptionHash: number[];
    if (m.descriptionHash) {
      if (m.descriptionHash.length !== 32) {
        die(`Milestone [${i}] descriptionHash must be 32 bytes.`);
      }
      descriptionHash = m.descriptionHash;
    } else if (m.description) {
      const hash = crypto
        .createHash("sha256")
        .update(m.description)
        .digest();
      descriptionHash = Array.from(hash);
    } else {
      // zero hash
      descriptionHash = new Array(32).fill(0);
    }

    return { amount, descriptionHash };
  });
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function usage(): void {
  console.log(`
Escrow CLI - Solana escrow program client

Usage: npx ts-node client/cli.ts <command> [options]

Commands:
  init-config
    --fee-bps <n>            Fee in basis points (0-10000)
    --dispute-timeout <n>    Dispute timeout in seconds
    --fee-collector <pubkey> Fee collector wallet address

  create-escrow
    --taker <pubkey>         Taker wallet address
    --mint <pubkey>          SPL token mint address
    --amount <n>             Total escrow amount (in token base units)
    --milestones <json>      JSON array: [{amount,description?},...] (1-5 items)
    --expires-in <seconds>   Seconds from now until expiry

  approve
    --escrow <pubkey>        Escrow PDA address
    --milestone <n>          Milestone index (0-based)

  release
    --escrow <pubkey>        Escrow PDA address
    --milestone <n>          Milestone index (0-based)
    --taker-ata <pubkey>     Taker associated token account (optional, derived if omitted)
    --fee-ata <pubkey>       Fee collector associated token account (optional, derived if omitted)

  dispute
    --escrow <pubkey>        Escrow PDA address
    --reason <text>          Reason text (hashed with SHA-256 on-chain)

  resolve
    --escrow <pubkey>        Escrow PDA address
    --resolution <value>     maker-wins | taker-wins | split:<BPS>
    --maker-ata <pubkey>     Maker associated token account (optional, derived if omitted)
    --taker-ata <pubkey>     Taker associated token account (optional, derived if omitted)
    --fee-ata <pubkey>       Fee collector associated token account (optional, derived if omitted)

  cancel
    --escrow <pubkey>        Escrow PDA address
    --maker-ata <pubkey>     Maker associated token account (optional, derived if omitted)

  claim-expired
    --escrow <pubkey>        Escrow PDA address
    --maker-ata <pubkey>     Maker associated token account (optional, derived if omitted)

  transfer-claim
    --escrow <pubkey>           Escrow PDA address
    --new-beneficiary <pubkey>  New beneficiary address to transfer claim to

  mint-receipt
    --escrow <pubkey>        Escrow PDA address (caller must be beneficiary, escrow must be Active)

  sync-beneficiary
    --escrow <pubkey>                    Escrow PDA address
    --receipt-token-account <pubkey>     Token account holding the Receipt NFT

  revoke-receipt
    --escrow <pubkey>        Escrow PDA address (clears burned Receipt NFT, re-enables transfer_claim)

  status
    --escrow <pubkey>        Escrow PDA address

Environment:
  ANCHOR_PROVIDER_URL  RPC endpoint (default: https://api.devnet.solana.com)
  ANCHOR_WALLET        Path to wallet keypair JSON (default: ~/.config/solana/id.json)
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    process.exit(0);
  }

  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  // Build provider and program
  const provider = buildProvider();
  anchor.setProvider(provider);

  const idl = loadIdl();
  const program = new anchor.Program(idl, provider);
  const client = new EscrowClient(program, provider);

  console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`RPC:    ${(provider.connection as Connection).rpcEndpoint}`);

  switch (command) {
    // ── init-config ──────────────────────────────────────────────────────────
    case "init-config": {
      const feeBps = requireNumber(args, "fee-bps");
      const disputeTimeout = new BN(requireNumber(args, "dispute-timeout"));
      const feeCollector = requirePubkey(args, "fee-collector");

      if (feeBps < 0 || feeBps > 10000) die("--fee-bps must be 0-10000.");

      console.log(`\nInitializing escrow config...`);
      console.log(`  fee_bps:          ${feeBps}`);
      console.log(`  dispute_timeout:  ${disputeTimeout.toString()}s`);
      console.log(`  fee_collector:    ${feeCollector.toBase58()}`);

      const sig = await client.initializeConfig(feeBps, disputeTimeout, feeCollector);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── create-escrow ────────────────────────────────────────────────────────
    case "create-escrow": {
      const taker = requirePubkey(args, "taker");
      const mint = requirePubkey(args, "mint");
      const amount = new BN(requireArg(args, "amount"));
      const milestonesRaw = requireArg(args, "milestones");
      const expiresIn = requireNumber(args, "expires-in");

      const milestones = parseMilestones(milestonesRaw);
      const expiresAt = new BN(Math.floor(Date.now() / 1000) + expiresIn);

      // Use a random seed unless provided
      const seedRaw = optionalArg(args, "seed");
      const seed = seedRaw
        ? new BN(seedRaw)
        : new BN(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

      const [escrowPDA] = findEscrowPDA(provider.wallet.publicKey, seed);

      console.log(`\nCreating escrow...`);
      console.log(`  taker:       ${taker.toBase58()}`);
      console.log(`  mint:        ${mint.toBase58()}`);
      console.log(`  amount:      ${amount.toString()}`);
      console.log(`  seed:        ${seed.toString()}`);
      console.log(`  milestones:  ${milestones.length}`);
      console.log(`  expires_at:  ${new Date(expiresAt.toNumber() * 1000).toISOString()}`);
      console.log(`  escrow PDA:  ${escrowPDA.toBase58()}`);

      const sig = await client.createEscrow(
        taker,
        mint,
        seed,
        amount,
        milestones,
        expiresAt
      );
      console.log(`\nSuccess! tx: ${sig}`);
      console.log(`Escrow PDA: ${escrowPDA.toBase58()}`);
      break;
    }

    // ── approve ──────────────────────────────────────────────────────────────
    case "approve": {
      const escrowPDA = requirePubkey(args, "escrow");
      const milestoneIndex = requireNumber(args, "milestone");

      console.log(`\nApproving milestone ${milestoneIndex}...`);
      console.log(`  escrow: ${escrowPDA.toBase58()}`);

      const sig = await client.approveMilestone(escrowPDA, milestoneIndex);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── release ──────────────────────────────────────────────────────────────
    case "release": {
      const escrowPDA = requirePubkey(args, "escrow");
      const milestoneIndex = requireNumber(args, "milestone");

      // Fetch escrow to derive ATAs if not provided
      const escrow = await client.fetchEscrow(escrowPDA);
      const mint = escrow.mint;

      const takerATA =
        optionalPubkey(args, "taker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.beneficiary);

      const config = await client.fetchConfig();
      const feeATA =
        optionalPubkey(args, "fee-ata") ??
        getAssociatedTokenAddressSync(mint, config.feeCollector);

      console.log(`\nReleasing milestone ${milestoneIndex}...`);
      console.log(`  escrow:          ${escrowPDA.toBase58()}`);
      console.log(`  taker_ata:       ${takerATA.toBase58()}`);
      console.log(`  fee_ata:         ${feeATA.toBase58()}`);

      const sig = await client.releaseMilestone(
        escrowPDA,
        milestoneIndex,
        takerATA,
        feeATA
      );
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── dispute ──────────────────────────────────────────────────────────────
    case "dispute": {
      const escrowPDA = requirePubkey(args, "escrow");
      const reason = requireArg(args, "reason");

      const reasonHash = Array.from(
        crypto.createHash("sha256").update(reason).digest()
      );

      console.log(`\nInitiating dispute...`);
      console.log(`  escrow:      ${escrowPDA.toBase58()}`);
      console.log(`  reason:      ${reason}`);
      console.log(`  reason_hash: ${Buffer.from(reasonHash).toString("hex")}`);

      const sig = await client.initiateDispute(escrowPDA, reasonHash);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── resolve ──────────────────────────────────────────────────────────────
    case "resolve": {
      const escrowPDA = requirePubkey(args, "escrow");
      const resolutionRaw = requireArg(args, "resolution");
      const resolution = parseResolution(resolutionRaw);

      const escrow = await client.fetchEscrow(escrowPDA);
      const mint = escrow.mint;
      const config = await client.fetchConfig();

      const makerATA =
        optionalPubkey(args, "maker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.maker);
      const takerATA =
        optionalPubkey(args, "taker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.beneficiary);
      const feeATA =
        optionalPubkey(args, "fee-ata") ??
        getAssociatedTokenAddressSync(mint, config.feeCollector);

      console.log(`\nResolving dispute...`);
      console.log(`  escrow:      ${escrowPDA.toBase58()}`);
      console.log(`  resolution:  ${resolutionRaw}`);
      console.log(`  maker_ata:   ${makerATA.toBase58()}`);
      console.log(`  taker_ata:   ${takerATA.toBase58()}`);
      console.log(`  fee_ata:     ${feeATA.toBase58()}`);

      const sig = await client.resolveDispute(
        escrowPDA,
        resolution,
        makerATA,
        takerATA,
        feeATA
      );
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── cancel ────────────────────────────────────────────────────────────────
    case "cancel": {
      const escrowPDA = requirePubkey(args, "escrow");
      const escrow = await client.fetchEscrow(escrowPDA);
      const mint = escrow.mint;

      const makerATA =
        optionalPubkey(args, "maker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.maker);

      console.log(`\nCancelling escrow...`);
      console.log(`  escrow:    ${escrowPDA.toBase58()}`);
      console.log(`  maker_ata: ${makerATA.toBase58()}`);

      const sig = await client.cancelEscrow(escrowPDA, makerATA);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── claim-expired ────────────────────────────────────────────────────────
    case "claim-expired": {
      const escrowPDA = requirePubkey(args, "escrow");
      const escrow = await client.fetchEscrow(escrowPDA);
      const mint = escrow.mint;
      const config = await client.fetchConfig();

      const makerATA =
        optionalPubkey(args, "maker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.maker);
      const beneficiaryATA = getAssociatedTokenAddressSync(mint, escrow.beneficiary);
      const feeATA = getAssociatedTokenAddressSync(mint, config.feeCollector);

      console.log(`\nClaiming expired escrow funds...`);
      console.log(`  escrow:    ${escrowPDA.toBase58()}`);
      console.log(`  maker_ata: ${makerATA.toBase58()}`);

      const sig = await client.claimExpired(escrowPDA, makerATA, beneficiaryATA, feeATA);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── transfer-claim ─────────────────────────────────────────────────────
    case "transfer-claim": {
      const escrowPDA = requirePubkey(args, "escrow");
      const newBeneficiary = requirePubkey(args, "new-beneficiary");

      console.log(`\nTransferring escrow claim...`);
      console.log(`  escrow:          ${escrowPDA.toBase58()}`);
      console.log(`  new_beneficiary: ${newBeneficiary.toBase58()}`);

      const sig = await client.transferClaim(escrowPDA, newBeneficiary);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── mint-receipt ─────────────────────────────────────────────
    case "mint-receipt": {
      const escrowPDA = requirePubkey(args, "escrow");

      console.log(`\nMinting Receipt NFT (caller must be beneficiary, escrow must be Active)...`);
      console.log(`  escrow: ${escrowPDA.toBase58()}`);

      const sig = await client.mintReceipt(escrowPDA);
      const [receiptMint] = findReceiptMintPDA(escrowPDA);
      console.log(`\nSuccess! tx: ${sig}`);
      console.log(`Receipt NFT Mint: ${receiptMint.toBase58()}`);
      break;
    }

    // ── sync-beneficiary ─────────────────────────────────────────────────
    case "sync-beneficiary": {
      const escrowPDA = requirePubkey(args, "escrow");
      const receiptTokenAccount = requirePubkey(args, "receipt-token-account");

      console.log(`\nSyncing beneficiary from Receipt NFT holder...`);
      console.log(`  escrow:                ${escrowPDA.toBase58()}`);
      console.log(`  receipt_token_account: ${receiptTokenAccount.toBase58()}`);

      const sig = await client.syncBeneficiary(escrowPDA, receiptTokenAccount);
      console.log(`\nSuccess! tx: ${sig}`);

      const escrow = await client.fetchEscrow(escrowPDA);
      console.log(`New beneficiary: ${escrow.beneficiary.toBase58()}`);
      break;
    }

    // ── revoke-receipt ───────────────────────────────────────────────────────
    case "revoke-receipt": {
      const escrowPDA = requirePubkey(args, "escrow");
      console.log("Revoking burned Receipt NFT...");
      const sig = await client.revokeReceipt(escrowPDA);
      console.log(`Receipt revoked: ${sig}`);
      break;
    }

    // ── update-config ──────────────────────────────────────────────────────
    case "update-config": {
      const config = await client.fetchConfig();

      const feeBpsRaw = optionalArg(args, "fee-bps");
      const feeBps = feeBpsRaw !== undefined ? Number(feeBpsRaw) : undefined;
      const disputeTimeoutRaw = optionalArg(args, "dispute-timeout");
      const disputeTimeout = disputeTimeoutRaw !== undefined ? new BN(disputeTimeoutRaw) : undefined;
      const feeCollector = optionalPubkey(args, "fee-collector") ?? config.feeCollector;
      const newAuthority = optionalPubkey(args, "new-authority");

      if (feeBps !== undefined && (feeBps < 0 || feeBps > 10000)) die("--fee-bps must be 0-10000.");

      console.log(`\nUpdating escrow config...`);
      if (feeBps !== undefined) console.log(`  fee_bps:          ${feeBps}`);
      if (disputeTimeout) console.log(`  dispute_timeout:  ${disputeTimeout.toString()}s`);
      console.log(`  fee_collector:    ${feeCollector.toBase58()}`);
      if (newAuthority) console.log(`  new_authority:    ${newAuthority.toBase58()}`);

      const sig = await client.updateConfig(feeCollector, newAuthority, feeBps, disputeTimeout);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── close-escrow ──────────────────────────────────────────────────────
    case "close-escrow": {
      const escrowPDA = requirePubkey(args, "escrow");
      const escrow = await client.fetchEscrow(escrowPDA);
      const mint = escrow.mint;

      const makerATA =
        optionalPubkey(args, "maker-ata") ??
        getAssociatedTokenAddressSync(mint, escrow.maker);

      console.log(`\nClosing escrow (must be terminal)...`);
      console.log(`  escrow:    ${escrowPDA.toBase58()}`);
      console.log(`  maker_ata: ${makerATA.toBase58()}`);

      const sig = await client.closeEscrow(escrowPDA, makerATA);
      console.log(`\nSuccess! tx: ${sig}`);
      break;
    }

    // ── status ────────────────────────────────────────────────────────────────
    case "status": {
      const escrowPDA = requirePubkey(args, "escrow");
      console.log(`\nFetching escrow status...`);
      console.log(`  escrow: ${escrowPDA.toBase58()}`);

      const escrow = await client.fetchEscrow(escrowPDA);
      formatEscrowState(escrow);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}\n`);
      usage();
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
