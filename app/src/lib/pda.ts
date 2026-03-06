/**
 * Re-export PDA helpers from the canonical client/pda module.
 * This avoids duplication and ensures a single source of truth.
 */
export {
  PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  findEscrowConfigPDA as findConfigPDATuple,
  findEscrowPDA as findEscrowPDATuple,
  findReceiptMintPDA as findReceiptMintPDATuple,
  findMetadataPDA as findMetadataPDATuple,
  findMasterEditionPDA as findMasterEditionPDATuple,
} from "../../../client/pda";

import {
  findEscrowConfigPDA as _findConfigPDA,
  findEscrowPDA as _findEscrowPDA,
  findReceiptMintPDA as _findReceiptMintPDA,
  findMetadataPDA as _findMetadataPDA,
  findMasterEditionPDA as _findMasterEditionPDA,
} from "../../../client/pda";

import type { BN } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";

// Convenience wrappers that return only the PublicKey (no bump)
// to maintain backward compatibility with existing app code.

export function findConfigPDA(
  programId?: PublicKey
): PublicKey {
  return _findConfigPDA(programId)[0];
}

export function findEscrowPDA(
  maker: PublicKey,
  seed: BN,
  programId?: PublicKey
): PublicKey {
  return _findEscrowPDA(maker, seed, programId)[0];
}

export function findReceiptMintPDA(
  escrowPDA: PublicKey,
  programId?: PublicKey
): PublicKey {
  return _findReceiptMintPDA(escrowPDA, programId)[0];
}

export function findMetadataPDA(mint: PublicKey): PublicKey {
  return _findMetadataPDA(mint)[0];
}

export function findMasterEditionPDA(mint: PublicKey): PublicKey {
  return _findMasterEditionPDA(mint)[0];
}
