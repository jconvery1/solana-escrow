use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowState {
    Created,
    Funded,
    Released,
    Cancelled,
}

#[account]
pub struct Escrow {
    pub initializer: Pubkey,     // 32 bytes
    pub recipient: Pubkey,       // 32 bytes
    pub amount: u64,             // 8 bytes
    pub state: EscrowState,      // 1 byte (enum)
    pub expiry: i64,             // 8 bytes
    pub bump: u8,                // 1 byte
}

impl Escrow {
    // Account size in bytes
    // 8 (discriminator) + 32 + 32 + 8 + 1 + 8 + 1
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1;
}