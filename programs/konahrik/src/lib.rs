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
}
