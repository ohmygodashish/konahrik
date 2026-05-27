pub mod constants;
pub mod errors;
pub mod instructions;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("3AhgyMSPhsKQFevVwGF2XNcDs8wBDxjz7g1HotFNNPWp");

#[program]
pub mod konahrik {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
