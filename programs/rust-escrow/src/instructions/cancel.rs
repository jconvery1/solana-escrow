use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::state::{Escrow, EscrowState};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        has_one = initializer,
        has_one = recipient,
        close = initializer,
        constraint = escrow.state == EscrowState::Created @ EscrowError::InvalidEscrowState,
        seeds = [
            b"escrow",
            initializer.key().as_ref(),
            recipient.key().as_ref(),
            &seed.to_le_bytes(),
        ],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

pub fn cancel(_ctx: Context<Cancel>, _seed: u64) -> Result<()> {
    // function empty by design, close is declared in the struct and runs after handler returns
    Ok(())
}