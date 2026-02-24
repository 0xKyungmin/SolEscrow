pub mod initialize_config;
pub mod create_escrow;
pub mod approve_milestone;
pub mod release_milestone;
pub mod initiate_dispute;
pub mod resolve_dispute;
pub mod cancel_escrow;
pub mod claim_expired;
pub mod update_config;
pub mod close_escrow;
pub mod transfer_claim;
pub mod mint_receipt;
pub mod sync_beneficiary;
pub mod revoke_receipt;

// Each module exports a `handler` fn — glob re-export causes name collision.
// Anchor's #[program] macro requires glob re-exports for generated account types.
#[allow(ambiguous_glob_reexports)]
pub use initialize_config::*;
pub use create_escrow::*;
pub use approve_milestone::*;
pub use release_milestone::*;
pub use initiate_dispute::*;
pub use resolve_dispute::*;
pub use cancel_escrow::*;
pub use claim_expired::*;
pub use update_config::*;
pub use close_escrow::*;
pub use transfer_claim::*;
pub use mint_receipt::*;
pub use sync_beneficiary::*;
pub use revoke_receipt::*;
