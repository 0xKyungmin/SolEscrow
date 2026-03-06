import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

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

export function findConfigPDA(
  programId: PublicKey = PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [ESCROW_CONFIG_SEED],
    programId
  );
  return pda;
}

export function findEscrowPDA(
  maker: PublicKey,
  seed: BN,
  programId: PublicKey = PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [ESCROW_SEED, maker.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

export function findReceiptMintPDA(
  escrowPDA: PublicKey,
  programId: PublicKey = PROGRAM_ID
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [RECEIPT_SEED, escrowPDA.toBuffer()],
    programId
  );
  return pda;
}

export function findMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

export function findMasterEditionPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}
