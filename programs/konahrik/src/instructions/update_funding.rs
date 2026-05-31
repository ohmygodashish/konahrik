use anchor_lang::prelude::*;

use crate::constants::AMM_STATE_SEED;
use crate::errors::KonahrikError;
use crate::oracle::get_index_price;
use crate::state::AmmState;

#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(
        mut,
        seeds = [AMM_STATE_SEED],
        bump = amm_state.bump,
    )]
    pub amm_state: Account<'info, AmmState>,

    /// CHECK: Pyth price feed account, validated by oracle module
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_update_funding(ctx: Context<UpdateFunding>) -> Result<()> {
    let amm_state = &ctx.accounts.amm_state;
    let now = ctx.accounts.clock.unix_timestamp;

    require!(
        now - amm_state.last_funding_ts >= amm_state.funding_period,
        KonahrikError::FundingNotDue
    );

    let index_price = get_index_price(&ctx.accounts.pyth_price_feed.to_account_info())?;

    let mark_price = amm_state
        .quote_asset_reserve
        .checked_mul(1_000_000_000)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(amm_state.base_asset_reserve)
        .ok_or(KonahrikError::MathOverflow)?;

    let funding_rate = (mark_price as i128)
        .checked_sub(index_price as i128)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_mul(1_000_000_000i128)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(index_price as i128)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(24i128)
        .ok_or(KonahrikError::MathOverflow)?;

    let amm_state = &mut ctx.accounts.amm_state;
    amm_state.cumulative_funding_rate = amm_state
        .cumulative_funding_rate
        .checked_add(funding_rate)
        .ok_or(KonahrikError::MathOverflow)?;
    amm_state.last_funding_ts = now;

    msg!(
        "Funding updated: mark={}, index={}, rate={}, cumulative={}",
        mark_price,
        index_price,
        funding_rate,
        amm_state.cumulative_funding_rate
    );

    Ok(())
}
