use anchor_lang::prelude::*;

#[error_code]
pub enum KonahrikError {
    #[msg("Invalid leverage. Must be 1-10.")]
    InvalidLeverage,
    #[msg("Insufficient margin.")]
    InsufficientMargin,
    #[msg("Insufficient margin to cover fees.")]
    InsufficientMarginForFee,
    #[msg("Insufficient amount.")]
    InsufficientAmount,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Slippage tolerance exceeded.")]
    SlippageExceeded,
    #[msg("Oracle price is stale.")]
    OracleStaleness,
    #[msg("Oracle confidence too wide.")]
    OracleConfidence,
    #[msg("Position is not liquidatable.")]
    PositionNotLiquidatable,
    #[msg("Funding period has not elapsed.")]
    FundingNotDue,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Withdrawal exceeds free collateral.")]
    WithdrawalExceedsAvailable,
    #[msg("Insufficient liquidity in vAMM.")]
    InsufficientLiquidity,
    #[msg("Self-liquidation not allowed.")]
    SelfLiquidation,
}
