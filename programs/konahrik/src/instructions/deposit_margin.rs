use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{AMM_STATE_SEED, MARGIN_SEED};
use crate::errors::KonahrikError;
use crate::state::{AmmState, UserMarginAccount};

#[derive(Accounts)]
pub struct DepositMargin<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 64,
        seeds = [MARGIN_SEED, user.key().as_ref()],
        bump
    )]
    pub user_margin_account: Account<'info, UserMarginAccount>,

    #[account(
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

    #[account(
        mut,
        constraint = user_usdc_account.owner == user.key(),
        constraint = user_usdc_account.mint == amm_state.usdc_mint,
    )]
    pub user_usdc_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_margin(ctx: Context<DepositMargin>, amount: u64) -> Result<()> {
    require!(amount > 0, KonahrikError::InsufficientAmount);

    let margin_account = &mut ctx.accounts.user_margin_account;

    require!(
        margin_account.owner == ctx.accounts.user.key()
            || margin_account.owner == Pubkey::default(),
        KonahrikError::Unauthorized
    );

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        cpi_accounts,
    );
    token::transfer(cpi_ctx, amount)?;

    margin_account.owner = ctx.accounts.user.key();
    margin_account.collateral = margin_account
        .collateral
        .checked_add(amount)
        .ok_or(KonahrikError::MathOverflow)?;
    margin_account.free_collateral = margin_account
        .free_collateral
        .checked_add(amount)
        .ok_or(KonahrikError::MathOverflow)?;
    margin_account.bump = ctx.bumps.user_margin_account;

    msg!(
        "Deposited {} USDC. Total collateral: {}",
        amount,
        margin_account.collateral
    );

    Ok(())
}
