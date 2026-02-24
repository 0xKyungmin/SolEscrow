import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  "GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF"
);

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const ESCROW_CONFIG_SEED = Buffer.from("escrow_config");
const ESCROW_SEED = Buffer.from("escrow");
const RECEIPT_SEED = Buffer.from("receipt");

// ─── PDA helpers ─────────────────────────────────────────────────────────────

export function findEscrowConfigPDA(
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ESCROW_CONFIG_SEED], programId);
}

export function findEscrowPDA(
  maker: PublicKey,
  seed: BN,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ESCROW_SEED, maker.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

export function findReceiptMintPDA(
  escrowPDA: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, escrowPDA.toBuffer()],
    programId
  );
}

export function findMetadataPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

export function findMasterEditionPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function createDescriptionHash(text: string): number[] {
  return Array.from(crypto.createHash("sha256").update(text).digest());
}

export function makeMilestones(
  amounts: BN[],
  descriptions: string[]
): { amount: BN; descriptionHash: number[] }[] {
  return amounts.map((amount, i) => ({
    amount,
    descriptionHash: createDescriptionHash(
      descriptions[i] ?? `milestone-${i}`
    ),
  }));
}
