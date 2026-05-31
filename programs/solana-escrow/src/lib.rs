use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("cY8CtfbqNgb4RMN1nBepmE2KDJx5i1CA4j7QeMThGMj");

#[program]
pub mod solana_escrow {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        seed: u64,
        amount: u64,
        expiry: i64,
    ) -> Result<()> {
        instructions::initialize::initialize(ctx, seed, amount, expiry)
    }

    pub fn fund(
        ctx: Context<Fund>,
        seed: u64,
    ) -> Result<()> {
        instructions::fund::fund(ctx, seed)
    }

    pub fn release(
        ctx: Context<Release>,
        seed: u64,
    ) -> Result<()> {
        instructions::release::release(ctx, seed)
    }

    pub fn cancel(
        ctx: Context<Cancel>,
        seed: u64,
    ) -> Result<()> {
        instructions::cancel::cancel(ctx, seed)
    }
}
