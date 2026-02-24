# On-Chain Escrow Engine on Solana

![Solana](https://img.shields.io/badge/Solana-14F195?style=for-the-badge&logo=solana&logoColor=000)
![Anchor](https://img.shields.io/badge/Anchor-0.32.1-blue?style=for-the-badge)
![Rust](https://img.shields.io/badge/Rust-CE422B?style=for-the-badge&logo=rust)
![Tests](https://img.shields.io/badge/Tests-76%20Passing-brightgreen?style=for-the-badge)

**Program ID:** [`GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF`](https://explorer.solana.com/address/GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF?cluster=devnet)

### Live on Devnet

| | |
|---|---|
| **Program** | [`GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF`](https://explorer.solana.com/address/GCc4exWhx2tyw9ELQw8Y29izvXNG2FcVdfkYk8wo8BsF?cluster=devnet) |
| **IDL Account** | [`Dx4R6HdjUa4YVkaE31qSNsvFzdfELZ8CP1ZFMNHhpjrs`](https://explorer.solana.com/address/Dx4R6HdjUa4YVkaE31qSNsvFzdfELZ8CP1ZFMNHhpjrs?cluster=devnet) |
| **Config PDA** | [`GyVKaFNyddGBCWLXd1YtKh5ruCAAAKRt8Z4vLkhhB1jh`](https://explorer.solana.com/address/GyVKaFNyddGBCWLXd1YtKh5ruCAAAKRt8Z4vLkhhB1jh?cluster=devnet) |

#### Verified Transactions (Full Lifecycle)

| Step | Transaction |
|------|-------------|
| Deploy | [`61LVBRA8...`](https://explorer.solana.com/tx/61LVBRA8bp3WuQ1dKqPGHhnxttvvxL9dDu4Wzh7LpHDExRkjrPPuy3XnHJF2w6SCi2X7YGTdG7XwEu5SLHikr74B?cluster=devnet) |
| Initialize Config | [`3XJEBDYP...`](https://explorer.solana.com/tx/3XJEBDYP3pM3wNWmZvg8s6oNKrVucv5KmMTy2ktRYmi5pQ8nVKoDSdc6hEFwQvDQFDHk5h1PFW8Bc7vdZpAMSwNb?cluster=devnet) |
| Create Escrow | [`3DXUQHh7...`](https://explorer.solana.com/tx/3DXUQHh7o25cP14yLdymirtPnRwuZyzaKKupeNS7TkPHBdoaNvrdmzPnUmTjHmi4g9XeTyj74hpmwPCsZ1wBxD6x?cluster=devnet) |
| Approve Milestone | [`2vL4hDiT...`](https://explorer.solana.com/tx/2vL4hDiTLfNj81ydWNb2ChEphHkfmqZ4h6ZWnXNgFT9nqhFUuZtLWJVcnxvpqcF6AJK4fnHGimHG8TZEdDhZmFdB?cluster=devnet) |
| Release Milestone | [`62pf7iYY...`](https://explorer.solana.com/tx/62pf7iYYenVK5rhw64CZR71VUq6MLr9Wi6PxysKpnQZRzdskH8JhpGPpsBR5hETE8gHBe8CX6wU6KLgeH9Ghwohq?cluster=devnet) |
| Cancel Escrow | [`5X5LvENb...`](https://explorer.solana.com/tx/5X5LvENbrfuDGVZ6FMkr8UBLWBjHYkyHnmFeBBGuvwCzZiqonJphA3M3LSv1zHSUBLxBJpDmqnxB8YFpnDS7mghY?cluster=devnet) |

---

## Web2 vs Solana: Design Analysis

### How Escrow Works in Web2

A company (Escrow.com, Stripe Connect, PayPal) holds funds in a bank account. Their backend code decides when to release. The user trusts the company not to freeze funds, go bankrupt, or commit fraud. Disputes are resolved via email tickets reviewed by humans in 3-14 days. Each platform is a silo — no interoperability.

### How This Works on Solana

Funds sit in a PDA-controlled vault with no private key. Release conditions are enforced by program logic, not human decisions. Anyone can verify the rules by reading the program. Anyone can trigger releases once conditions are met.

| Concept | Web2 | Solana (This Program) |
|---|---|---|
| Fund custody | Company bank account | PDA vault (no private key exists) |
| Release logic | Backend `if` statements | On-chain state machine (verifiable) |
| Fee structure | Hidden / variable | Transparent `fee_bps` stored on-chain |
| Dispute resolution | Email ticket, days | On-chain with timeout fallback |
| Expiration refund | Support request | Permissionless `claim_expired` (bot-cranked) |
| Integration | REST API + webhooks | CPI — atomic, composable |
| Audit trail | Mutable database | Immutable blockchain events |
| Payment rights transfer | Not possible | `transfer_claim` + Receipt NFT (tradeable) |

### Key Tradeoffs

| Decision | Tradeoff |
|---|---|
| Bounded milestones (max 5) | Limits flexibility but keeps account size predictable |
| Description hashes instead of on-chain text | Requires off-chain storage but saves rent costs |
| Authority-based dispute resolution | Centralized but pragmatic; authority can be swapped to a DAO multisig without code changes |
| Fee-on-release (not deposit) | More fee txns per escrow but matches user expectations |
| Token-2022 rejection | Loses compatibility but prevents transfer-fee accounting bugs |

---

## Architecture

### Account Model

```
EscrowConfig (Singleton PDA: ["escrow_config"])
  ├── authority: Pubkey
  ├── fee_bps: u16
  ├── fee_collector: Pubkey
  ├── dispute_timeout: i64
  └── bump: u8

EscrowState (Per-escrow PDA: ["escrow", maker_pubkey, seed_le_bytes])
  ├── maker / taker / beneficiary: Pubkey
  ├── mint: Pubkey
  ├── amount / released_amount / refunded_amount: u64
  ├── seed: u64
  ├── status: Active | Completed | Disputed | Cancelled | Expired
  ├── milestones: Vec<Milestone>  (1-5)
  ├── expires_at: i64
  ├── dispute: Option<Dispute>
  ├── receipt_mint: Option<Pubkey>
  └── bump: u8

Vault (ATA: mint + escrow_state PDA as authority)
  No private key. Only the program can sign transfers.
```

### State Machine

```
                ┌─────────┐
         ┌──────│ Active  │──────┐
         │      └────┬────┘      │
    (cancel)    (dispute)   (all milestones
         │           │       released)
         ▼           ▼           ▼
   ┌──────────┐ ┌─────────┐ ┌───────────┐
   │Cancelled │ │Disputed │ │ Completed │
   └──────────┘ └────┬────┘ └───────────┘
                     │
              (authority resolves
               OR timeout expires)
                     │
              ┌──────┴──────┐
              ▼             ▼
        ┌───────────┐ ┌─────────┐
        │ Completed │ │ Expired │
        └───────────┘ └─────────┘
```

### Instruction Set (14 Total)

| Instruction | Access Control | What It Does |
|---|---|---|
| `initialize_config` | Authority (signer) | Creates singleton config PDA |
| `update_config` | Authority (signer) | Updates fee, timeout, or transfers authority |
| `create_escrow` | Maker (signer, pays) | Deposits tokens into PDA vault, sets milestones |
| `approve_milestone` | Maker (signer) | Marks milestone as approved |
| `release_milestone` | **Permissionless** | Transfers approved milestone funds to beneficiary minus fee |
| `initiate_dispute` | Maker or Taker (signer) | Freezes escrow, records dispute on-chain |
| `resolve_dispute` | Authority (signer) | Distributes funds per resolution (MakerWins/TakerWins/Split) |
| `cancel_escrow` | Maker (signer) | Refunds pending milestones |
| `claim_expired` | **Permissionless** | Refunds maker after expiration or dispute timeout |
| `close_escrow` | Maker (signer) | Closes terminal escrow, reclaims rent |
| `transfer_claim` | Beneficiary (signer) | Transfers payment rights to a new address |
| `mint_receipt` | Beneficiary (signer) | Mints Receipt NFT representing payment rights |
| `sync_beneficiary` | **Permissionless** | Syncs escrow beneficiary to current Receipt NFT holder |
| `revoke_receipt` | **Permissionless** | Clears receipt_mint after NFT is burned |

---

## Security

| Validation | Where |
|---|---|
| Owner checks on all token accounts | cancel, claim_expired, release, resolve |
| Mint match constraints | All token instructions |
| PDA seeds verification | All escrow instructions |
| Expiration check | approve, release |
| Checked arithmetic (no overflow) | All calculations |
| Fee snapshot at creation (`fee_bps_at_creation`) | Config changes don't affect existing escrows |
| 50/50 split on dispute timeout | Fair fallback when authority is inactive |
| Token-2022 extended mint rejection | Prevents transfer-fee accounting issues |
| Freeze authority rejection | Prevents vault freeze griefing |
| 1-hour minimum expiration | Prevents instant-expiry griefing |
| Receipt NFT sync verification | release, claim_expired, resolve check NFT holder matches beneficiary |

---

## Testing

76 integration tests covering all instructions, authorization failures, validation failures, dispute resolutions, transferable claims, and Receipt NFT lifecycle.

```bash
anchor test    # 76 passing
```

---

## Quick Start

### Prerequisites

- Rust 1.70+ | Solana CLI 2.0+ | Anchor 0.32.1 | Node.js 18+

### Build & Test

```bash
npm install
anchor build
anchor test
```

### Deploy

```bash
anchor deploy --provider.cluster devnet --program-name escrow
```

---

## Client

### CLI (`client/cli.ts`)

```bash
npx ts-node client/cli.ts init-config --fee-bps 250 --dispute-timeout 86400 --fee-collector <pubkey>
npx ts-node client/cli.ts create-escrow --taker <pubkey> --mint <pubkey> --amount 100000000 \
  --milestones '[{"amount":60000000,"description":"Phase 1"},{"amount":40000000,"description":"Phase 2"}]' \
  --expires-in 604800
npx ts-node client/cli.ts approve --escrow <pda> --milestone 0
npx ts-node client/cli.ts release --escrow <pda> --milestone 0
npx ts-node client/cli.ts status --escrow <pda>
```

### Client Library (`client/escrow-client.ts`)

```typescript
import { EscrowClient } from "./client/escrow-client";
import { findEscrowPDA, findEscrowConfigPDA } from "./client/pda";

const client = new EscrowClient(program, provider);
const [escrowPDA] = findEscrowPDA(maker, seed);

await client.createEscrow(taker, mint, seed, amount, milestones, expiresAt);
await client.approveMilestone(escrowPDA, 0);
await client.releaseMilestone(escrowPDA, 0, beneficiaryATA, feeATA);
```

### Devnet Demo

```bash
npx ts-node --transpile-only scripts/devnet-demo.ts
```

---

## Project Structure

```
earn/
├── programs/escrow/src/
│   ├── lib.rs                      14 instruction entry points
│   ├── state.rs                    EscrowConfig, EscrowState, Milestone, Dispute
│   ├── error.rs                    Custom error codes
│   ├── events.rs                   Event types
│   ├── helpers.rs                  Shared utilities (transfer, fee calc, receipt sync)
│   └── instructions/
│       ├── initialize_config.rs
│       ├── update_config.rs
│       ├── create_escrow.rs
│       ├── approve_milestone.rs
│       ├── release_milestone.rs
│       ├── initiate_dispute.rs
│       ├── resolve_dispute.rs
│       ├── cancel_escrow.rs
│       ├── claim_expired.rs
│       ├── close_escrow.rs
│       ├── transfer_claim.rs
│       ├── mint_receipt.rs
│       ├── sync_beneficiary.rs
│       └── revoke_receipt.rs
├── client/
│   ├── escrow-client.ts            TypeScript client library
│   ├── cli.ts                      CLI tool
│   └── pda.ts                      PDA derivation helpers
├── app/                            Next.js frontend
├── scripts/devnet-demo.ts          Full lifecycle demo
└── tests/
    ├── escrow.ts                   65 integration tests
    └── escrow-bankrun.ts           11 bankrun tests (fast)
```
