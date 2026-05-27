use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{AMM_STATE_SEED, VAULT_AUTHORITY_SEED};
use crate::errors::KonahrikError;
use crate::state::AmmState;

#[derive(Accounts)]
pub struct InitializeAmm<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 280,
        seeds = [AMM_STATE_SEED],
        bump
    )]
    pub amm_state: Account<'info, AmmState>,

    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority, no data needed
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: Pyth price feed account, validated by oracle module
    pub pyth_feed: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeAmmParams {
    pub initial_base_reserve: u128,
    pub initial_quote_reserve: u128,
    pub initial_margin_bps: u16,
    pub maint_margin_bps: u16,
    pub liquidation_fee_bps: u16,
    pub trading_fee_bps: u16,
    pub funding_period: i64,
}

pub fn handler(ctx: Context<InitializeAmm>, params: InitializeAmmParams) -> Result<()> {
    require!(
        params.initial_base_reserve > 0 && params.initial_quote_reserve > 0,
        KonahrikError::InsufficientAmount
    );

    let k = params
        .initial_base_reserve
        .checked_mul(params.initial_quote_reserve)
        .ok_or(KonahrikError::MathOverflow)?;

    let amm_state = &mut ctx.accounts.amm_state;
    amm_state.authority = ctx.accounts.authority.key();
    amm_state.base_asset_reserve = params.initial_base_reserve;
    amm_state.quote_asset_reserve = params.initial_quote_reserve;
    amm_state.k = k;
    amm_state.cumulative_funding_rate = 0;
    amm_state.last_funding_ts = Clock::get()?.unix_timestamp;
    amm_state.open_interest_long = 0;
    amm_state.open_interest_short = 0;
    amm_state.usdc_mint = ctx.accounts.usdc_mint.key();
    amm_state.vault = ctx.accounts.vault.key();
    amm_state.pyth_feed = ctx.accounts.pyth_feed.key();
    amm_state.initial_margin_bps = params.initial_margin_bps;
    amm_state.maint_margin_bps = params.maint_margin_bps;
    amm_state.liquidation_fee_bps = params.liquidation_fee_bps;
    amm_state.trading_fee_bps = params.trading_fee_bps;
    amm_state.funding_period = params.funding_period;
    amm_state.bump = ctx.bumps.amm_state;

    msg!("AMM initialized with mark price: {}", 
        (amm_state.quote_asset_reserve * 1_000_000 / amm_state.base_asset_reserve) as u64
    );

    Ok(())
}
