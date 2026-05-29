use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::state::{Escrow, EscrowState};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Release<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        has_one = initializer,
        has_one = recipient,
        close = initializer,
        constraint = escrow.state == EscrowState::Funded @ EscrowError::InvalidEscrowState,
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

pub fn release(
    ctx: Context<Release>,
    _seed: u64
) -> Result<()> {
    // move lamports from escrow to recipient account
    let amount = ctx.accounts.escrow.amount;
    **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

    Ok(())
}
