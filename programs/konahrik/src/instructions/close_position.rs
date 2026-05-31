use anchor_lang::prelude::*;

use crate::constants::{AMM_STATE_SEED, MARGIN_SEED, POSITION_SEED};
use crate::errors::KonahrikError;
use crate::oracle::get_index_price;
use crate::state::{AmmState, Position, UserMarginAccount};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MARGIN_SEED, user.key().as_ref()],
        bump = user_margin_account.bump,
    )]
    pub user_margin_account: Account<'info, UserMarginAccount>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            user.key().as_ref(),
            position.position_id.to_le_bytes().as_ref(),
        ],
        bump = position.bump,
        close = user,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [AMM_STATE_SEED],
        bump = amm_state.bump,
    )]
    pub amm_state: Account<'info, AmmState>,

    /// CHECK: Pyth price feed account, validated by oracle module
    pub pyth_price_feed: UncheckedAccount<'info>,
}

pub fn handle_close_position(ctx: Context<ClosePosition>) -> Result<()> {
    let position = &ctx.accounts.position;
    require!(
        position.owner == ctx.accounts.user.key(),
        KonahrikError::Unauthorized
    );

    let _index_price = get_index_price(&ctx.accounts.pyth_price_feed.to_account_info())?;

    let amm_state = &ctx.accounts.amm_state;

    let funding_delta = (position.notional as i128)
        .checked_mul(
            amm_state
                .cumulative_funding_rate
                .checked_sub(position.funding_snapshot)
                .ok_or(KonahrikError::MathOverflow)?,
        )
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(1_000_000_000i128)
        .ok_or(KonahrikError::MathOverflow)?;

    let signed_funding = if position.is_long {
        funding_delta
    } else {
        funding_delta.checked_neg().ok_or(KonahrikError::MathOverflow)?
    };

    let amm_state = &mut ctx.accounts.amm_state;
    let position_size_u128 = position.size as u128;

    let (new_base, new_quote, quote_received, quote_paid) = if position.is_long {
        let new_base = amm_state
            .base_asset_reserve
            .checked_add(position_size_u128)
            .ok_or(KonahrikError::MathOverflow)?;
        let new_quote = amm_state
            .k
            .checked_div(new_base)
            .ok_or(KonahrikError::MathOverflow)?;
        let quote_received = amm_state
            .quote_asset_reserve
            .checked_sub(new_quote)
            .ok_or(KonahrikError::MathOverflow)?;
        (new_base, new_quote, quote_received as i64, 0i64)
    } else {
        let new_base = amm_state
            .base_asset_reserve
            .checked_sub(position_size_u128)
            .ok_or(KonahrikError::MathOverflow)?;
        let new_quote = amm_state
            .k
            .checked_div(new_base)
            .ok_or(KonahrikError::MathOverflow)?;
        let quote_paid = new_quote
            .checked_sub(amm_state.quote_asset_reserve)
            .ok_or(KonahrikError::MathOverflow)?;
        (new_base, new_quote, 0i64, quote_paid as i64)
    };

    let realized_pnl = if position.is_long {
        quote_received - position.notional as i64
    } else {
        position.notional as i64 - quote_paid
    };

    let exit_notional = if position.is_long {
        quote_received.unsigned_abs()
    } else {
        quote_paid.unsigned_abs()
    };

    let trading_fee = exit_notional
        .checked_mul(amm_state.trading_fee_bps as u64)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(KonahrikError::MathOverflow)?;

    let net_return = (position.margin as i64)
        .checked_add(realized_pnl)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_sub(signed_funding as i64)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_sub(trading_fee as i64)
        .ok_or(KonahrikError::MathOverflow)?
        .max(0) as u64;

    amm_state.base_asset_reserve = new_base;
    amm_state.quote_asset_reserve = new_quote;

    if position.is_long {
        amm_state.open_interest_long = amm_state
            .open_interest_long
            .checked_sub(position.notional)
            .ok_or(KonahrikError::MathOverflow)?;
    } else {
        amm_state.open_interest_short = amm_state
            .open_interest_short
            .checked_sub(position.notional)
            .ok_or(KonahrikError::MathOverflow)?;
    }

    let margin_account = &mut ctx.accounts.user_margin_account;
    margin_account.collateral = (margin_account.collateral as i64)
        .checked_sub(position.margin as i64)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_add(net_return as i64)
        .ok_or(KonahrikError::MathOverflow)?
        .max(0) as u64;
    margin_account.free_collateral = margin_account
        .free_collateral
        .checked_add(net_return)
        .ok_or(KonahrikError::MathOverflow)?;

    msg!(
        "Closed position #{}: pnl={}, funding={}, fee={}, net_return={}",
        position.position_id,
        realized_pnl,
        signed_funding,
        trading_fee,
        net_return,
    );

    Ok(())
}
