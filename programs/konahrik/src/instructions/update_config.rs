use anchor_lang::prelude::*;

use crate::constants::AMM_STATE_SEED;
use crate::errors::KonahrikError;
use crate::state::AmmState;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [AMM_STATE_SEED],
        bump = amm_state.bump,
        has_one = authority @ KonahrikError::Unauthorized,
    )]
    pub amm_state: Account<'info, AmmState>,

    pub authority: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateConfigParams {
    pub initial_margin_bps: Option<u16>,
    pub maint_margin_bps: Option<u16>,
    pub liquidation_fee_bps: Option<u16>,
    pub trading_fee_bps: Option<u16>,
    pub funding_period: Option<i64>,
    pub base_reserve: Option<u128>,
    pub quote_reserve: Option<u128>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    params: UpdateConfigParams,
) -> Result<()> {
    let amm_state = &mut ctx.accounts.amm_state;

    if let Some(val) = params.initial_margin_bps {
        amm_state.initial_margin_bps = val;
    }
    if let Some(val) = params.maint_margin_bps {
        amm_state.maint_margin_bps = val;
    }
    if let Some(val) = params.liquidation_fee_bps {
        amm_state.liquidation_fee_bps = val;
    }
    if let Some(val) = params.trading_fee_bps {
        amm_state.trading_fee_bps = val;
    }
    if let Some(val) = params.funding_period {
        require!(val > 0, KonahrikError::InsufficientAmount);
        amm_state.funding_period = val;
    }

    let update_base = params.base_reserve.is_some();
    let update_quote = params.quote_reserve.is_some();
    if update_base || update_quote {
        if let Some(val) = params.base_reserve {
            amm_state.base_asset_reserve = val;
        }
        if let Some(val) = params.quote_reserve {
            amm_state.quote_asset_reserve = val;
        }
        amm_state.k = amm_state
            .base_asset_reserve
            .checked_mul(amm_state.quote_asset_reserve)
            .ok_or(KonahrikError::MathOverflow)?;
    }

    msg!(
        "Config updated: init_margin={}, maint_margin={}, liq_fee={}, trade_fee={}, funding_period={}, base_reserve={}, quote_reserve={}, k={}",
        amm_state.initial_margin_bps,
        amm_state.maint_margin_bps,
        amm_state.liquidation_fee_bps,
        amm_state.trading_fee_bps,
        amm_state.funding_period,
        amm_state.base_asset_reserve,
        amm_state.quote_asset_reserve,
        amm_state.k,
    );

    Ok(())
}
