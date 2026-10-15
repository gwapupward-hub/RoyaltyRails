use anchor_lang::prelude::*;

pub mod pda;
pub mod state;

// Temporary compile-time development ID for the Phase 3A scaffold only.
// Before local-validator/devnet deployment, generate the program keypair and
// run `anchor keys sync`; never treat this address as a production deployment ID.
declare_id!("ErqjTNhQWyLCjJZpFg9jyGAgWJS7KYLN5kFUiNf3KYdH");

#[program]
pub mod royaltyrail {
    use super::*;
}
