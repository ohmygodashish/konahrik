use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{AMM_STATE_SEED, MARGIN_SEED, VAULT_AUTHORITY_SEED};
use crate::errors::KonahrikError;
use crate::state::{AmmState, UserMarginAccount};

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MARGIN_SEED, user.key().as_ref()],
        bump = user_margin_account.bump,
        constraint = user_margin_account.owner == user.key() @ KonahrikError::Unauthorized,
    )]
    pub user_margin_account: Account<'info, UserMarginAccount>,

    #[account(
        mut,
        constraint = user_usdc_account.owner == user.key(),
        constraint = user_usdc_account.mint == amm_state.usdc_mint,
    )]
    pub user_usdc_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault.key() == amm_state.vault,
        constraint = vault.mint == amm_state.usdc_mint,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA used as vault authority, no data needed
    #[account(
        seeds = [VAULT_AUTHORITY_SEED],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        seeds = [AMM_STATE_SEED],
        bump = amm_state.bump,
    )]
    pub amm_state: Account<'info, AmmState>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
    require!(amount > 0, KonahrikError::InsufficientAmount);

    let margin_account = &ctx.accounts.user_margin_account;

    require!(
        amount <= margin_account.free_collateral,
        KonahrikError::WithdrawalExceedsAvailable
    );

    let vault_authority_bump = ctx.bumps.vault_authority;
    let signer_seeds: &[&[&[u8]]] = &[&[VAULT_AUTHORITY_SEED, &[vault_authority_bump]]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_usdc_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, amount)?;

    let margin_account = &mut ctx.accounts.user_margin_account;
    margin_account.free_collateral = margin_account
        .free_collateral
        .checked_sub(amount)
        .ok_or(KonahrikError::MathOverflow)?;
    margin_account.collateral = margin_account
        .collateral
        .checked_sub(amount)
        .ok_or(KonahrikError::MathOverflow)?;

    msg!(
        "Withdrew {} USDC. Remaining collateral: {}",
        amount,
        margin_account.collateral
    );

    Ok(())
}
