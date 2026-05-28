use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::state::{Escrow, EscrowState};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    pub recipient: SystemAccount<'info>,

    #[account(
        init,
        payer = initializer,
        space = Escrow::LEN,
        seeds = [
            b"escrow",
            initializer.key().as_ref(),
            recipient.key().as_ref(),
            &seed.to_le_bytes(),
        ],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<Initialize>,
    _seed: u64,
    amount: u64,
    expiry: i64,
) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(expiry > now, EscrowError::ExpiryInPast);

    // populate the fresh escrow account
    let escrow = &mut ctx.accounts.escrow;
    escrow.initializer = ctx.accounts.initializer.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.amount = amount;
    escrow.state = EscrowState::Created;
    escrow.expiry = expiry;
    escrow.bump = ctx.bumps.escrow;

    Ok(())
}
