use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::EscrowError;
use crate::state::{Escrow, EscrowState};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct Fund<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        has_one = initializer,
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
    pub system_program: Program<'info, System>,
}

pub fn fund(
    ctx: Context<Fund>,
    _seed: u64
) -> Result<()> {
    // set the cpi_accounts and cpi_ctx to be used for the transfer operation
    let cpi_accounts = Transfer {
        from: ctx.accounts.initializer.to_account_info(),
        to:   ctx.accounts.escrow.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
    );

    // transfer amount from the signer to the escrow account
    system_program::transfer(cpi_ctx, ctx.accounts.escrow.amount)?;
    
    // update the escrow state
    let escrow = &mut ctx.accounts.escrow;
    escrow.state = EscrowState::Funded;

    Ok(())
}
