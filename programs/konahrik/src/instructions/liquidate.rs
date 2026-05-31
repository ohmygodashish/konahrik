use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{AMM_STATE_SEED, MARGIN_SEED, POSITION_SEED, VAULT_AUTHORITY_SEED};
use crate::errors::KonahrikError;
use crate::oracle::get_index_price;
use crate::state::{AmmState, Position, UserMarginAccount};

#[derive(Accounts)]
#[instruction(params: LiquidateParams)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(
        mut,
        constraint = liquidator_usdc_account.owner == liquidator.key(),
        constraint = liquidator_usdc_account.mint == amm_state.usdc_mint,
    )]
    pub liquidator_usdc_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [MARGIN_SEED, params.position_owner.as_ref()],
        bump = position_owner_margin.bump,
    )]
    pub position_owner_margin: Account<'info, UserMarginAccount>,

    #[account(
        mut,
        seeds = [
            POSITION_SEED,
            params.position_owner.as_ref(),
            params.position_id.to_le_bytes().as_ref(),
        ],
        bump = position.bump,
        close = liquidator,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        seeds = [AMM_STATE_SEED],
        bump = amm_state.bump,
    )]
    pub amm_state: Account<'info, AmmState>,

    #[account(
        mut,
        constraint = vault.key() == amm_state.vault,
        constraint = vault.mint == amm_state.usdc_mint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// CHECK: Pyth price feed account, validated by oracle module
    pub pyth_price_feed: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct LiquidateParams {
    pub position_owner: Pubkey,
    pub position_id: u32,
}

pub fn handle_liquidate(ctx: Context<Liquidate>, params: LiquidateParams) -> Result<()> {
    require!(
        params.position_owner != ctx.accounts.liquidator.key(),
        KonahrikError::SelfLiquidation
    );

    let position = &ctx.accounts.position;
    require!(
        position.owner == params.position_owner,
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

    let mark_price = amm_state
        .quote_asset_reserve
        .checked_mul(1_000_000_000)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(amm_state.base_asset_reserve)
        .ok_or(KonahrikError::MathOverflow)?;

    let entry_price = position.entry_price as i64;
    let size_sol = position.size as i64;

    let unrealized_pnl = if position.is_long {
        (mark_price as i64)
            .checked_sub(entry_price)
            .ok_or(KonahrikError::MathOverflow)?
            .checked_mul(size_sol)
            .ok_or(KonahrikError::MathOverflow)?
            .checked_div(1_000_000_000)
            .ok_or(KonahrikError::MathOverflow)?
    } else {
        entry_price
            .checked_sub(mark_price as i64)
            .ok_or(KonahrikError::MathOverflow)?
            .checked_mul(size_sol)
            .ok_or(KonahrikError::MathOverflow)?
            .checked_div(1_000_000_000)
            .ok_or(KonahrikError::MathOverflow)?
    };

    let margin_ratio_bps = (position.margin as i64)
        .checked_add(unrealized_pnl)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_mul(10_000)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(position.notional as i64)
        .ok_or(KonahrikError::MathOverflow)?;

    require!(
        margin_ratio_bps < amm_state.maint_margin_bps as i64,
        KonahrikError::PositionNotLiquidatable
    );

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

    let liq_fee = position
        .notional
        .checked_mul(amm_state.liquidation_fee_bps as u64)
        .ok_or(KonahrikError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(KonahrikError::MathOverflow)?;

    let vault_authority_bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[vault_authority_bump]]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.liquidator_usdc_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, liq_fee)?;

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

    let margin_account = &mut ctx.accounts.position_owner_margin;
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
        "Liquidated position #{}: pnl={}, funding={}, liq_fee={}, net_return={}",
        position.position_id,
        realized_pnl,
        signed_funding,
        liq_fee,
        net_return,
    );

    Ok(())
}
