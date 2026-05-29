use anchor_lang::prelude::*;

use crate::constants::{AMM_STATE_SEED, MARGIN_SEED, POSITION_SEED};
use crate::errors::KonahrikError;
use crate::oracle::get_index_price;
use crate::state::{AmmState, Position, UserMarginAccount};

#[derive(Accounts)]
#[instruction(params: OpenPositionParams)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MARGIN_SEED, user.key().as_ref()],
        bump = user_margin_account.bump,
    )]
    pub user_margin_account: Account<'info, UserMarginAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + 104,
        seeds = [
            POSITION_SEED,
            user.key().as_ref(),
            user_margin_account.next_position_id.to_le_bytes().as_ref(),
        ],
        bump
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

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenPositionParams {
    pub is_long: bool,
    pub collateral_amount: u64,
    pub leverage: u8,
    pub min_base_amount: u64,
}

pub fn handle_open_position(ctx: Context<OpenPosition>, params: OpenPositionParams) -> Result<()> {
    require!(
        params.leverage >= 1 && params.leverage <= 10,
        KonahrikError::InvalidLeverage
    );
    require!(params.collateral_amount > 0, KonahrikError::InsufficientAmount);

    let margin_account = &ctx.accounts.user_margin_account;
    require!(
        margin_account.owner == ctx.accounts.user.key(),
        KonahrikError::Unauthorized
    );
    require!(
        params.collateral_amount <= margin_account.free_collateral,
        KonahrikError::InsufficientMargin
    );

    let _index_price = get_index_price(&ctx.accounts.pyth_price_feed.to_account_info())?;

    let notional = (params.collateral_amount as u128)
        .checked_mul(params.leverage as u128)
        .ok_or(KonahrikError::MathOverflow)? as u64;

    let amm_state = &ctx.accounts.amm_state;
    let trading_fee = notional
        .checked_mul(amm_state.trading_fee_bps as u64)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(KonahrikError::MathOverflow)?;

    require!(
        params.collateral_amount > trading_fee,
        KonahrikError::InsufficientMarginForFee
    );
    let margin_locked = params.collateral_amount - trading_fee;

    let amm_state = &mut ctx.accounts.amm_state;
    let notional_u128 = notional as u128;

    let (new_base, new_quote, base_acquired) = if params.is_long {
        let new_quote = amm_state
            .quote_asset_reserve
            .checked_add(notional_u128)
            .ok_or(KonahrikError::MathOverflow)?;
        let new_base = amm_state
            .k
            .checked_div(new_quote)
            .ok_or(KonahrikError::MathOverflow)?;
        let base_acquired = amm_state
            .base_asset_reserve
            .checked_sub(new_base)
            .ok_or(KonahrikError::MathOverflow)?;
        require!(
            base_acquired as u64 >= params.min_base_amount,
            KonahrikError::SlippageExceeded
        );
        (new_base, new_quote, base_acquired)
    } else {
        require!(
            notional_u128 < amm_state.quote_asset_reserve,
            KonahrikError::InsufficientLiquidity
        );
        let new_quote = amm_state
            .quote_asset_reserve
            .checked_sub(notional_u128)
            .ok_or(KonahrikError::MathOverflow)?;
        let new_base = amm_state
            .k
            .checked_div(new_quote)
            .ok_or(KonahrikError::MathOverflow)?;
        let base_released = new_base
            .checked_sub(amm_state.base_asset_reserve)
            .ok_or(KonahrikError::MathOverflow)?;
        require!(
            base_released as u64 >= params.min_base_amount,
            KonahrikError::SlippageExceeded
        );
        (new_base, new_quote, base_released)
    };

    amm_state.base_asset_reserve = new_base;
    amm_state.quote_asset_reserve = new_quote;

    if params.is_long {
        amm_state.open_interest_long = amm_state
            .open_interest_long
            .checked_add(notional)
            .ok_or(KonahrikError::MathOverflow)?;
    } else {
        amm_state.open_interest_short = amm_state
            .open_interest_short
            .checked_add(notional)
            .ok_or(KonahrikError::MathOverflow)?;
    }

    let margin_account = &mut ctx.accounts.user_margin_account;
    margin_account.free_collateral = margin_account
        .free_collateral
        .checked_sub(params.collateral_amount)
        .ok_or(KonahrikError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    let size = base_acquired as u64;
    position.owner = ctx.accounts.user.key();
    position.position_id = margin_account.next_position_id;
    position.is_long = params.is_long;
    position.size = size;
    position.notional = notional;
    position.entry_price = (notional_u128
        .checked_mul(1_000_000)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(size as u128)
        .ok_or(KonahrikError::MathOverflow)?) as u64;
    position.margin = margin_locked;
    position.funding_snapshot = amm_state.cumulative_funding_rate;
    position.bump = ctx.bumps.position;

    margin_account.next_position_id = margin_account
        .next_position_id
        .checked_add(1)
        .ok_or(KonahrikError::MathOverflow)?;

    msg!(
        "Opened {} position #{}: size={}, notional={}, entry_price={}, margin={}",
        if params.is_long { "LONG" } else { "SHORT" },
        position.position_id,
        position.size,
        position.notional,
        position.entry_price,
        position.margin,
    );

    Ok(())
}
