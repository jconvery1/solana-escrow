use anchor_lang::prelude::*;
pub mod state;
pub mod instructions;
pub mod errors;

declare_id!("CA4VBPqPv34hiyzqFkgq2MzjSEkViyT5HJyTgZazsLSH");

#[program]
pub mod rust_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}