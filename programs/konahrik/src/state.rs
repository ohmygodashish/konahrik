use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AmmState {
    pub authority: Pubkey,

    pub base_asset_reserve: u128,
    pub quote_asset_reserve: u128,
    pub k: u128,

    pub cumulative_funding_rate: i128,
    pub last_funding_ts: i64,

    pub open_interest_long: u64,
    pub open_interest_short: u64,

    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub pyth_feed: Pubkey,

    pub initial_margin_bps: u16,
    pub maint_margin_bps: u16,
    pub liquidation_fee_bps: u16,
    pub trading_fee_bps: u16,
    pub funding_period: i64,

    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserMarginAccount {
    pub owner: Pubkey,
    pub collateral: u64,
    pub free_collateral: u64,
    pub next_position_id: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub position_id: u32,
    pub is_long: bool,
    pub size: u64,
    pub notional: u64,
    pub entry_price: u64,
    pub margin: u64,
    pub funding_snapshot: i128,
    pub bump: u8,
}
