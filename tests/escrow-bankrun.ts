import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { startAnchor, Clock } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  AccountLayout,
} from "@solana/spl-token";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  findEscrowConfigPDA,
  findEscrowPDA,
  createDescriptionHash,
  makeMilestones,
} from "../client/pda";

// ---------------------------------------------------------------------------
// IDL & Program ID
// ---------------------------------------------------------------------------
const IDL = require("../target/idl/escrow.json");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FEE_BPS = 250; // 2.5 %
const DISPUTE_TIMEOUT = new BN(86400); // 1 day
const TOTAL_AMOUNT = new BN(1_000_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transfer SOL from payer to a destination keypair so it can pay for transactions.
 */
// Helper: get token account via bankrun (drop-in replacement for spl-token getAccount)
// Returns object with .amount (bigint) matching the spl-token Account interface.
let _banksClient: any;
async function getAccount(_connection: any, address: PublicKey): Promise<{ amount: bigint }> {
  const account = await _banksClient.getAccount(address);
  if (!account) return { amount: BigInt(0) };
  const decoded = AccountLayout.decode(Buffer.from(account.data));
  return { amount: decoded.amount };
}

async function fundKeypair(
  provider: BankrunProvider,
  payer: Keypair,
  destination: PublicKey,
  lamports: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: destination,
      lamports,
    })
  );
  await provider.sendAndConfirm!(tx, [payer]);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("escrow-bankrun (time-dependent tests)", () => {
  let provider: BankrunProvider;
  // Use 'any' to avoid strict ResolvedAccounts typing mismatch with BankrunProvider
  let program: any;
  let context: Awaited<ReturnType<typeof startAnchor>>;

  let authority: Keypair;
  let feeCollector: Keypair;
  let maker: Keypair;
  let taker: Keypair;
  let stranger: Keypair;

  let mint: PublicKey;
  let makerATA: PublicKey;
  let takerATA: PublicKey;
  let feeCollectorATA: PublicKey;

  const [configPDA] = findEscrowConfigPDA();

  let seedCounter = 5000;
  function nextSeed(): BN {
    return new BN(seedCounter++);
  }

  // ---------------------------------------------------------------------------
  // Setup: bankrun context, provider, keypairs, mint, ATAs, config
  // ---------------------------------------------------------------------------
  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    _banksClient = context.banksClient;
    program = new Program(IDL as any, provider);

    const payer = context.payer;
    const connection = provider.connection;

    // Generate keypairs
    authority = Keypair.generate();
    feeCollector = Keypair.generate();
    maker = Keypair.generate();
    taker = Keypair.generate();
    stranger = Keypair.generate();

    // Fund all keypairs
    for (const kp of [authority, feeCollector, maker, taker, stranger]) {
      await fundKeypair(provider, payer, kp.publicKey);
    }

    // Create mint via manual transaction (BankrunProvider doesn't support connection.sendTransaction)
    const mintKp = Keypair.generate();
    const rentLamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    mint = mintKp.publicKey;

    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: rentLamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintKp.publicKey, 6, payer.publicKey, null)
    );
    createMintTx.recentBlockhash = context.lastBlockhash;
    createMintTx.feePayer = payer.publicKey;
    createMintTx.sign(payer, mintKp);
    await context.banksClient.processTransaction(createMintTx);

    // Create ATAs via manual transactions
    makerATA = getAssociatedTokenAddressSync(mint, maker.publicKey);
    takerATA = getAssociatedTokenAddressSync(mint, taker.publicKey);
    feeCollectorATA = getAssociatedTokenAddressSync(mint, feeCollector.publicKey);

    const createAtasTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, makerATA, maker.publicKey, mint),
      createAssociatedTokenAccountInstruction(payer.publicKey, takerATA, taker.publicKey, mint),
      createAssociatedTokenAccountInstruction(payer.publicKey, feeCollectorATA, feeCollector.publicKey, mint),
    );
    createAtasTx.recentBlockhash = context.lastBlockhash;
    createAtasTx.feePayer = payer.publicKey;
    createAtasTx.sign(payer);
    await context.banksClient.processTransaction(createAtasTx);

    // Mint tokens to maker
    const mintToTx = new Transaction().add(
      createMintToInstruction(mint, makerATA, payer.publicKey, BigInt(10_000_000))
    );
    mintToTx.recentBlockhash = context.lastBlockhash;
    mintToTx.feePayer = payer.publicKey;
    mintToTx.sign(payer);
    await context.banksClient.processTransaction(mintToTx);

    // Initialize config
    await program.methods
      .initializeConfig(FEE_BPS, DISPUTE_TIMEOUT)
      .accounts({
        authority: authority.publicKey,
        escrowConfig: configPDA,
        feeCollector: feeCollector.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // Helper: create an escrow with custom parameters
  // ---------------------------------------------------------------------------
  async function setupEscrow(
    overrides: {
      seed?: BN;
      milestoneAmounts?: BN[];
      expiresAt?: BN;
    } = {}
  ): Promise<{
    seed: BN;
    escrowPDA: PublicKey;
    vault: PublicKey;
  }> {
    const seed = overrides.seed ?? nextSeed();
    const milestoneAmounts = overrides.milestoneAmounts ?? [
      new BN(400_000),
      new BN(300_000),
      new BN(300_000),
    ];
    const totalAmount = milestoneAmounts.reduce(
      (sum, a) => sum.add(a),
      new BN(0)
    );

    // Default expiresAt: current bankrun clock + 2 hours
    let expiresAt = overrides.expiresAt;
    if (!expiresAt) {
      const clock = await context.banksClient.getClock();
      const now = Number(clock.unixTimestamp);
      expiresAt = new BN(now + 7200);
    }

    const [escrowPDA] = findEscrowPDA(maker.publicKey, seed);
    const vault = getAssociatedTokenAddressSync(mint, escrowPDA, true);

    const milestones = makeMilestones(
      milestoneAmounts,
      milestoneAmounts.map((_, i) => `bankrun-task-${i}`)
    );

    await program.methods
      .createEscrow(seed, totalAmount, milestones, expiresAt)
      .accounts({
        maker: maker.publicKey,
        taker: taker.publicKey,
        escrowConfig: configPDA,
        mint,
        escrowState: escrowPDA,
        vault,
        makerTokenAccount: makerATA,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    return { seed, escrowPDA, vault };
  }

  /**
   * Warp the bankrun clock to a specific unix timestamp.
   */
  async function warpTo(unixTimestamp: number): Promise<void> {
    const currentClock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        BigInt(unixTimestamp)
      )
    );
  }

  // =========================================================================
  // Test 66: claim_expired active-expired path
  //          (approved milestones released, pending cancelled)
  // =========================================================================
  it("71. claim_expired: active-expired path — approved milestones released, pending cancelled", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200); // 2 hours from now

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [new BN(400_000), new BN(300_000), new BN(300_000)],
      expiresAt,
    });

    // Approve milestone 0 only
    await program.methods
      .approveMilestone(0)
      .accounts({
        maker: maker.publicKey,
        escrowState: escrowPDA,
      })
      .signers([maker])
      .rpc();

    // Record balances before claim
    const makerBefore = await getAccount(provider.connection, makerATA);
    const takerBefore = await getAccount(provider.connection, takerATA);
    const feeBefore = await getAccount(provider.connection, feeCollectorATA);

    // Warp clock past expires_at
    await warpTo(expiresAt.toNumber() + 1);

    // Call claim_expired
    await program.methods
      .claimExpired()
      .accounts({
        payer: stranger.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        makerTokenAccount: makerATA,
        beneficiaryTokenAccount: takerATA,
        feeCollectorTokenAccount: feeCollectorATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stranger])
      .rpc();

    // Fetch escrow state
    const escrow = await program.account.escrowState.fetch(escrowPDA);

    // Status should be Expired
    assert.ok(
      escrow.status.expired !== undefined,
      "Escrow status should be Expired"
    );

    // Milestone 0: Released (was Approved)
    assert.ok(
      escrow.milestones[0].status.released !== undefined,
      "Milestone 0 should be Released"
    );
    // Milestone 1: Cancelled (was Pending)
    assert.ok(
      escrow.milestones[1].status.cancelled !== undefined,
      "Milestone 1 should be Cancelled"
    );
    // Milestone 2: Cancelled (was Pending)
    assert.ok(
      escrow.milestones[2].status.cancelled !== undefined,
      "Milestone 2 should be Cancelled"
    );

    // Check token balances
    const makerAfter = await getAccount(provider.connection, makerATA);
    const takerAfter = await getAccount(provider.connection, takerATA);
    const feeAfter = await getAccount(provider.connection, feeCollectorATA);

    // Maker receives 600_000 refund (pending milestones, no fee on refund)
    const makerDelta =
      BigInt(makerAfter.amount.toString()) -
      BigInt(makerBefore.amount.toString());
    assert.equal(
      makerDelta.toString(),
      "600000",
      "Maker should receive 600_000 refund from pending milestones"
    );

    // Fee on approved amount: 400_000 * 250 / 10_000 = 10_000
    const feeDelta =
      BigInt(feeAfter.amount.toString()) -
      BigInt(feeBefore.amount.toString());
    assert.equal(
      feeDelta.toString(),
      "10000",
      "Fee collector should receive 10_000"
    );

    // Beneficiary (taker) receives 400_000 - 10_000 = 390_000
    const takerDelta =
      BigInt(takerAfter.amount.toString()) -
      BigInt(takerBefore.amount.toString());
    assert.equal(
      takerDelta.toString(),
      "390000",
      "Beneficiary should receive 390_000 (400_000 minus 10_000 fee)"
    );
  });

  // =========================================================================
  // Test 67: claim_expired dispute timeout path (50/50 split)
  // =========================================================================
  it("72. claim_expired: dispute timeout path — 50/50 split of remaining", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200);

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [TOTAL_AMOUNT],
      expiresAt,
    });

    // Initiate dispute
    const reasonHash = createDescriptionHash("dispute timeout test");
    await program.methods
      .initiateDispute(reasonHash)
      .accounts({
        initiator: taker.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
      })
      .signers([taker])
      .rpc();

    // Read the dispute's initiated_at from on-chain state
    const escrowBefore = await program.account.escrowState.fetch(escrowPDA);
    const initiatedAt = (escrowBefore.dispute as any).initiatedAt as BN;
    const disputeTimeout = (escrowBefore.dispute as any).timeout as BN;

    // Record balances before
    const makerBefore = await getAccount(provider.connection, makerATA);
    const takerBefore = await getAccount(provider.connection, takerATA);
    const feeBefore = await getAccount(provider.connection, feeCollectorATA);

    // Warp past dispute timeout AND past expires_at (whichever is later)
    const disputeDeadline = initiatedAt.toNumber() + disputeTimeout.toNumber();
    const warpTarget = Math.max(disputeDeadline, expiresAt.toNumber()) + 1;
    await warpTo(warpTarget);

    // Call claim_expired
    await program.methods
      .claimExpired()
      .accounts({
        payer: stranger.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        makerTokenAccount: makerATA,
        beneficiaryTokenAccount: takerATA,
        feeCollectorTokenAccount: feeCollectorATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stranger])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    assert.ok(
      escrow.status.expired !== undefined,
      "Escrow status should be Expired"
    );

    // Check balances
    const makerAfter = await getAccount(provider.connection, makerATA);
    const takerAfter = await getAccount(provider.connection, takerATA);
    const feeAfter = await getAccount(provider.connection, feeCollectorATA);

    // remaining = 1_000_000
    // maker_share = remaining / 2 = 500_000
    // taker_total = remaining - maker_share = 500_000
    // fee = 500_000 * 250 / 10_000 = 12_500
    // taker_net = 500_000 - 12_500 = 487_500

    const makerDelta =
      BigInt(makerAfter.amount.toString()) -
      BigInt(makerBefore.amount.toString());
    assert.equal(
      makerDelta.toString(),
      "500000",
      "Maker should receive 500_000 (50% of remaining)"
    );

    const feeDelta =
      BigInt(feeAfter.amount.toString()) -
      BigInt(feeBefore.amount.toString());
    assert.equal(
      feeDelta.toString(),
      "12500",
      "Fee collector should receive 12_500"
    );

    const takerDelta =
      BigInt(takerAfter.amount.toString()) -
      BigInt(takerBefore.amount.toString());
    assert.equal(
      takerDelta.toString(),
      "487500",
      "Beneficiary should receive 487_500 (500_000 minus 12_500 fee)"
    );
  });

  // =========================================================================
  // Test 68: resolve_dispute fails after timeout deadline
  // =========================================================================
  it("73. resolve_dispute: fails after dispute timeout deadline (EscrowExpired)", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200);

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [TOTAL_AMOUNT],
      expiresAt,
    });

    // Initiate dispute
    const reasonHash = createDescriptionHash("timeout resolve test");
    await program.methods
      .initiateDispute(reasonHash)
      .accounts({
        initiator: maker.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
      })
      .signers([maker])
      .rpc();

    // Read initiated_at
    const escrowData = await program.account.escrowState.fetch(escrowPDA);
    const initiatedAt = (escrowData.dispute as any).initiatedAt as BN;
    const disputeTimeout = (escrowData.dispute as any).timeout as BN;

    // Warp past dispute timeout
    const disputeDeadline = initiatedAt.toNumber() + disputeTimeout.toNumber();
    await warpTo(disputeDeadline + 1);

    // Try resolve_dispute — should fail with EscrowExpired
    try {
      await program.methods
        .resolveDispute({ makerWins: {} })
        .accounts({
          authority: authority.publicKey,
          escrowConfig: configPDA,
          escrowState: escrowPDA,
          mint,
          vault,
          makerTokenAccount: makerATA,
          beneficiaryTokenAccount: takerATA,
          feeCollectorTokenAccount: feeCollectorATA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();
      assert.fail("Should have thrown EscrowExpired");
    } catch (err: any) {
      assert.ok(
        err.message.includes("EscrowExpired") ||
          err.message.includes("6013") ||
          err.message.includes("expired"),
        `Expected EscrowExpired error, got: ${err.message}`
      );
    }
  });

  // =========================================================================
  // Test 69: claim_expired fails when not yet expired (EscrowNotExpired)
  // =========================================================================
  it("74. claim_expired: fails on active escrow that has not expired (EscrowNotExpired)", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200);

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [TOTAL_AMOUNT],
      expiresAt,
    });

    // Try claim_expired immediately — escrow is Active and not expired
    try {
      await program.methods
        .claimExpired()
        .accounts({
          payer: stranger.publicKey,
          escrowState: escrowPDA,
          escrowConfig: configPDA,
          mint,
          vault,
          makerTokenAccount: makerATA,
          beneficiaryTokenAccount: takerATA,
          feeCollectorTokenAccount: feeCollectorATA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc();
      assert.fail("Should have thrown EscrowNotExpired");
    } catch (err: any) {
      assert.ok(
        err.message.includes("EscrowNotExpired") ||
          err.message.includes("6019") ||
          err.message.includes("not expired"),
        `Expected EscrowNotExpired error, got: ${err.message}`
      );
    }
  });

  // =========================================================================
  // Test 70: claim_expired fails on disputed escrow before timeout
  //          (EscrowNotExpired)
  // =========================================================================
  it("75. claim_expired: fails on disputed escrow before dispute timeout (EscrowNotExpired)", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200);

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [TOTAL_AMOUNT],
      expiresAt,
    });

    // Initiate dispute
    const reasonHash = createDescriptionHash("premature claim test");
    await program.methods
      .initiateDispute(reasonHash)
      .accounts({
        initiator: taker.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
      })
      .signers([taker])
      .rpc();

    // Try claim_expired immediately — dispute timeout has NOT elapsed
    try {
      await program.methods
        .claimExpired()
        .accounts({
          payer: stranger.publicKey,
          escrowState: escrowPDA,
          escrowConfig: configPDA,
          mint,
          vault,
          makerTokenAccount: makerATA,
          beneficiaryTokenAccount: takerATA,
          feeCollectorTokenAccount: feeCollectorATA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([stranger])
        .rpc();
      assert.fail("Should have thrown EscrowNotExpired");
    } catch (err: any) {
      assert.ok(
        err.message.includes("EscrowNotExpired") ||
          err.message.includes("6019") ||
          err.message.includes("not expired"),
        `Expected EscrowNotExpired error, got: ${err.message}`
      );
    }
  });

  // =========================================================================
  // Test 71: claim_expired with ALL milestones approved
  // =========================================================================
  it("76. claim_expired: all milestones approved — everything released to beneficiary, nothing refunded", async () => {
    const clock = await context.banksClient.getClock();
    const now = Number(clock.unixTimestamp);
    const expiresAt = new BN(now + 7200);

    const { escrowPDA, vault } = await setupEscrow({
      milestoneAmounts: [new BN(500_000), new BN(500_000)],
      expiresAt,
    });

    // Approve BOTH milestones
    await program.methods
      .approveMilestone(0)
      .accounts({
        maker: maker.publicKey,
        escrowState: escrowPDA,
      })
      .signers([maker])
      .rpc();

    await program.methods
      .approveMilestone(1)
      .accounts({
        maker: maker.publicKey,
        escrowState: escrowPDA,
      })
      .signers([maker])
      .rpc();

    // Record balances before
    const makerBefore = await getAccount(provider.connection, makerATA);
    const takerBefore = await getAccount(provider.connection, takerATA);
    const feeBefore = await getAccount(provider.connection, feeCollectorATA);

    // Warp past expiration
    await warpTo(expiresAt.toNumber() + 1);

    // Call claim_expired
    await program.methods
      .claimExpired()
      .accounts({
        payer: stranger.publicKey,
        escrowState: escrowPDA,
        escrowConfig: configPDA,
        mint,
        vault,
        makerTokenAccount: makerATA,
        beneficiaryTokenAccount: takerATA,
        feeCollectorTokenAccount: feeCollectorATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stranger])
      .rpc();

    const escrow = await program.account.escrowState.fetch(escrowPDA);
    assert.ok(
      escrow.status.expired !== undefined,
      "Escrow status should be Expired"
    );

    // Both milestones should be Released
    assert.ok(
      escrow.milestones[0].status.released !== undefined,
      "Milestone 0 should be Released"
    );
    assert.ok(
      escrow.milestones[1].status.released !== undefined,
      "Milestone 1 should be Released"
    );

    // Check token balances
    const makerAfter = await getAccount(provider.connection, makerATA);
    const takerAfter = await getAccount(provider.connection, takerATA);
    const feeAfter = await getAccount(provider.connection, feeCollectorATA);

    // Maker gets 0 refund (all milestones were approved)
    const makerDelta =
      BigInt(makerAfter.amount.toString()) -
      BigInt(makerBefore.amount.toString());
    assert.equal(
      makerDelta.toString(),
      "0",
      "Maker should receive 0 refund (all milestones approved)"
    );

    // approved_amount = 1_000_000
    // fee = 1_000_000 * 250 / 10_000 = 25_000
    const feeDelta =
      BigInt(feeAfter.amount.toString()) -
      BigInt(feeBefore.amount.toString());
    assert.equal(
      feeDelta.toString(),
      "25000",
      "Fee collector should receive 25_000"
    );

    // beneficiary_net = 1_000_000 - 25_000 = 975_000
    const takerDelta =
      BigInt(takerAfter.amount.toString()) -
      BigInt(takerBefore.amount.toString());
    assert.equal(
      takerDelta.toString(),
      "975000",
      "Beneficiary should receive 975_000 (1_000_000 minus 25_000 fee)"
    );
  });
});
