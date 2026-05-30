pub mod constants;
pub mod errors;
pub mod instructions;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk");

#[program]
pub mod konahrik {
    use super::*;

    pub fn initialize_amm(
        ctx: Context<InitializeAmm>,
        params: InitializeAmmParams,
    ) -> Result<()> {
        instructions::handle_initialize_amm(ctx, params)
    }

    pub fn deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {
        instructions::handle_deposit_margin(ctx, amount)
    }

    pub fn open_position(
        ctx: Context<OpenPosition>,
        params: OpenPositionParams,
    ) -> Result<()> {
        instructions::handle_open_position(ctx, params)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::handle_close_position(ctx)
    }

    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        instructions::handle_withdraw_margin(ctx, amount)
    }

    pub fn update_funding(ctx: Context<UpdateFunding>) -> Result<()> {
        instructions::handle_update_funding(ctx)
    }
}
