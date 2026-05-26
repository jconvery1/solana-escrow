use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError{
    #[msg("Signer is not authorized to perform this action")]
    Unauthorized,
    #[msg("Escrow is not in a valid state for this operation")]
    InvalidEscrowState,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Token mint does not match the expected mint")]
    InvalidMint,
    #[msg("Arithmetic overflow occurred")]
    Overflow
}