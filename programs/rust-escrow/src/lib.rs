use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("CA4VBPqPv34hiyzqFkgq2MzjSEkViyT5HJyTgZazsLSH");

#[program]
pub mod rust_escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        seed: u64,
        amount: u64,
        expiry: i64,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, seed, amount, expiry)
    }
}
