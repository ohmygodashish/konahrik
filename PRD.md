# Product Requirements Document
## Project: Konahrik - vAMM Perpetuals DEX
**Version:** 2.1 (Updated for Anchor 1.0.1, Next.js 16.2.x, Node 22+)
**Target:** Solana India Fellowship Capstone Project
**Network:** Devnet
**Stack:** Anchor 1.0.1 (Rust) · Next.js 16.2.x · Tailwind CSS · TypeScript · Pyth Oracle · Node.js 22+

---
## 0. Scope Philosophy
This document is scoped for a 3-5 day build. Every section that would be correct for a production system but cannot be completed and demoed in that window is explicitly marked `[V2]` and excluded from scaffolding. The agent must not implement V2 items.

The single demo loop that must work end-to-end:

```markdown
1. Admin initializes the AMM (once, via script)
2. User connects wallet, deposits devnet USDC as margin
3. User opens single or multiple leveraged LONG or SHORT positions on SOL/USDC
4. The vAMM mark price shifts visibly on the UI
5. User closes a position and receives net PnL back to margin
6. [Stretch - Day 5] A second wallet liquidates an underwater position
```

Everything in this PRD exists to make that loop work. Nothing else.

## 1. What a vAMM Is (Scaffolding Context)
A Virtual AMM uses the constant product formula `x * y = k` purely for price discovery. No real assets are stored inside it. The formula answers one question: "if a trader puts in `Δy` notional USDC, how many virtual SOL units do they receive?"

```markdown
base_reserve * quote_reserve = k   (k is constant)

LONG: trader adds Δy quote -> base_reserve decreases -> mark price rises
SHORT: trader removes Δy quote -> base_reserve increases -> mark price falls
```

All real USDC collateral lives in a single vault token account whose signing authority is a PDA. The vAMM numbers (`base_reserve`, `quote_reserve`) are just fields in the `AmmState` account - they are updated in-place on every trade.

One trader's profit is another trader's loss. There are no liquidity providers.

## 2. Accounts (On-Chain State)
Three custom account types. All are PDAs owned by the program.
### 2.1 `AmmState`
**PDA seeds:** `[b"amm_state"]`
**Created by:** `initialize_amm` (called once by the deployer)

```rust
#[account]
#[derive(InitSpace)]
pub struct AmmState {
    // Identity
    pub authority: Pubkey,               // 32 - deployer, can update params

    // vAMM virtual reserves (u128 - intermediate math overflows u64)
    pub base_asset_reserve: u128,        // 16 - virtual SOL (scaled 1e9)
    pub quote_asset_reserve: u128,       // 16 - virtual USDC (scaled 1e6)
    pub k: u128,                         // 16 - constant = base * quote at init

    // Funding (simplified - no TWAP, no keeper required)
    pub cumulative_funding_rate: i128,   // 16 - global accumulator (scaled 1e9)
    pub last_funding_ts: i64,            // 8  - unix timestamp of last update

    // Open interest tracking
    pub open_interest_long: u64,         // 8  - total notional long (scaled 1e6)
    pub open_interest_short: u64,        // 8  - total notional short (scaled 1e6)

    // Protocol config
    pub usdc_mint: Pubkey,               // 32
    pub vault: Pubkey,                   // 32 - USDC vault token account
    pub pyth_feed: Pubkey,               // 32 - Pyth SOL/USD price feed account

    // Risk parameters (in basis points, e.g. 1000 = 10%)
    pub initial_margin_bps: u16,         // 2  - min margin to open (1000 = 10% -> 10x max)
    pub maint_margin_bps: u16,           // 2  - liquidation threshold (625 = 6.25%)
    pub liquidation_fee_bps: u16,        // 2  - fee to liquidator (250 = 2.5%)
    pub trading_fee_bps: u16,            // 2  - protocol fee on notional (10 = 0.1%)
    pub funding_period: i64,             // 8  - seconds between funding updates (3600)

    // PDA bump
    pub bump: u8,                        // 1
}
// Space: 8 (discriminator) + ~261 -> allocate 8 + 280
```
### 2.2 `UserMarginAccount`
**PDA seeds:** `[b"margin", user_wallet.key().as_ref()]`
**Created by:** `deposit_margin` on first call (uses `init_if_needed`)

```rust
#[account]
#[derive(InitSpace)]
pub struct UserMarginAccount {
    pub owner: Pubkey,               // 32 - owner of the margin account
    pub collateral: u64,             // 8  - total USDC deposited (scaled 1e6)
    pub free_collateral: u64,        // 8  - collateral not locked in a position
    pub next_position_id: u32,       // 4  - incrementing ID for multiple positions
    pub bump: u8,                    // 1  - PDA bump
}
// Space: 8 + 53 -> allocate 8 + 64
```
### 2.3 `Position`
**PDA seeds:** `[b"position", user_wallet.key().as_ref(), position_id.to_le_bytes().as_ref()]`
**Created by:** `open_position` · **Closed (rent reclaimed) by:** `close_position` or `liquidate`
**Constraint:** Supports multiple positions per user by utilizing `position_id`.

```rust
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,                      // 32 - owner of the position
    pub position_id: u32,                   // 4  - distinct ID for the user's position
    pub is_long: bool,                      // 1  - true = LONG, false = SHORT
    pub size: u64,                          // 8  - base asset units acquired (virtual SOL, 1e9)
    pub notional: u64,                      // 8  - USDC notional at entry (1e6)
    pub entry_price: u64,                   // 8  - (notional / size) scaled to 1e6
    pub margin: u64,                        // 8  - USDC margin locked for this position
    pub funding_snapshot: i128,             // 16 - cumulative_funding_rate at open
    pub bump: u8,                           // 1  - PDA bump
}
// Space: 8 + 86 -> allocate 8 + 104
```

**Liquidation price formula (compute in the TypeScript client for display - not stored on-chain):**
```markdown
LONG:  liq_price = entry_price * (1 - (initial_margin_bps - maint_margin_bps) / 10000)
SHORT: liq_price = entry_price * (1 + (initial_margin_bps - maint_margin_bps) / 10000)
```

## 3. Instructions
Five instructions for the MVP. The agent implements them in this order - each one is independently testable before moving to the next.

```markdown
Day 1: initialize_amm + deposit_margin
Day 2: open_position + close_position
Day 3: update_funding + liquidate (stretch)
Day 4-5: Frontend + integration tests
```
### Instruction 1: `initialize_amm`
**Who:** Deployer only. Called once via a `scripts/init.ts` script.
**Creates:** `AmmState` PDA, `vault` USDC token account.

**Parameters:**
```rust
pub struct InitializeAmmParams {
    pub initial_base_reserve: u128,   // e.g. 1_000_000 * 1_000_000_000 (1M virtual SOL)
    pub initial_quote_reserve: u128,  // e.g. 140_000_000 * 1_000_000 (140M virtual USDC -> $140 price)
    pub initial_margin_bps: u16,      // 1000
    pub maint_margin_bps: u16,        // 625
    pub liquidation_fee_bps: u16,     // 250
    pub trading_fee_bps: u16,         // 10
    pub funding_period: i64,          // 3600
}
```

**Accounts:**
```rust
authority          [signer, mut]
amm_state          PDA [b"amm_state"]                init, payer = authority
vault              Token account                     init, authority = vault_authority PDA
vault_authority    PDA [b"vault_authority"]          seeds only, not stored
usdc_mint          Mint
pyth_feed          UncheckedAccount<'info>           stored address only
token_program      Program<Token>
system_program     Program<System>
rent               Sysvar<Rent>
```

**Logic (pseudocode):**
```rust
// 1. Validate initial reserves
1. require!(initial_base_reserve > 0 && initial_quote_reserve > 0)
// 2. Compute k
2. k = initial_base_reserve.checked_mul(initial_quote_reserve) // must not overflow
// 3. Populate state
3. Populate AmmState fields
// 4. Set initial funding timestamp
4. amm_state.last_funding_ts = Clock::get()?.unix_timestamp
// 5. Initialize funding rate
5. amm_state.cumulative_funding_rate = 0
```
### Instruction 2: `deposit_margin`
**Who:** Any trader.
**Creates or updates:** `UserMarginAccount` PDA. Default `next_position_id` is 0.
**Transfers:** USDC from user wallet -> vault.

**Parameters:**
```rust
pub amount: u64  // must be > 0
```

**Accounts:**
```rust
user                   [signer, mut]
user_margin_account    PDA [b"margin", user.key()]   init_if_needed, payer = user
amm_state              PDA [b"amm_state"]            read-only (to get vault address for constraint)
vault                  Token account                 mut
user_usdc_account      Token account                 mut, owner = user
token_program          Program<Token>
system_program         Program<System>
```

**Logic:**
```rust
// 1. Ensure deposit is non-zero
1. require!(amount > 0, InsufficientAmount)
// 2. Transfer tokens to vault
2. CPI: token::transfer { from: user_usdc_account, to: vault, authority: user, amount }
// 3. Update margin account owner
3. user_margin_account.owner = user.key()
// 4. Add to total collateral
4. user_margin_account.collateral += amount
// 5. Add to free collateral
5. user_margin_account.free_collateral += amount
```

**Security checks:**
- `init_if_needed`: guard against reinitialization attack by checking `user_margin_account.owner == user.key() || user_margin_account.owner == Pubkey::default()`
- Anchor's `init_if_needed` feature flag must be enabled: `anchor-lang = { version = "1.0.1", features = ["init-if-needed"] }`
### Instruction 3: `open_position`
**Who:** Trader with an existing `UserMarginAccount`.
**Creates:** `Position` PDA.
**Updates:** `AmmState` reserves, `UserMarginAccount.free_collateral`, `UserMarginAccount.next_position_id`.

**Parameters:**
```rust
pub struct OpenPositionParams {
    pub is_long: bool,
    pub collateral_amount: u64,  // USDC margin to lock
    pub leverage: u8,            // 1 to 10
    pub min_base_amount: u64,    // slippage protection - min virtual SOL to receive
}
```

**Accounts:**
```rust
user                   [signer]
user_margin_account    PDA [b"margin", user.key()]        mut, has_one = owner (user)
position               PDA [b"position", user.key(), user_margin_account.next_position_id.to_le_bytes()] init, payer = user
amm_state              PDA [b"amm_state"]                 mut
pyth_price_feed        Account<'info, PriceUpdateV2>      read-only
system_program         Program<System>
```

**Logic (full detail):**
```rust
// --- Validation ---
1. require!(leverage >= 1 && leverage <= 10, InvalidLeverage)
2. require!(collateral_amount > 0, InsufficientAmount)
3. require!(collateral_amount <= user_margin_account.free_collateral, InsufficientMargin)

// --- Oracle check ---
4. index_price = get_index_price(&pyth_price_feed)?

// --- Fee ---
5. notional = (collateral_amount as u128)
               .checked_mul(leverage as u128)
               .ok_or(MathOverflow)? as u64
6. trading_fee = notional * amm_state.trading_fee_bps as u64 / 10_000
7. require!(collateral_amount > trading_fee, InsufficientMarginForFee)
8. margin_locked = collateral_amount - trading_fee

// --- vAMM swap ---
// LONG: trader adds notional to quote side, receives base
9a. (LONG)
    new_quote = amm_state.quote_asset_reserve
                    .checked_add(notional as u128).ok_or(MathOverflow)?
    new_base  = amm_state.k.checked_div(new_quote).ok_or(MathOverflow)?
    base_acquired = amm_state.base_asset_reserve
                        .checked_sub(new_base).ok_or(MathOverflow)?
    require!(base_acquired as u64 >= min_base_amount, SlippageExceeded)

9b. (SHORT)
    require!(notional as u128 < amm_state.quote_asset_reserve, InsufficientLiquidity)
    new_quote = amm_state.quote_asset_reserve
                    .checked_sub(notional as u128).ok_or(MathOverflow)?
    new_base  = amm_state.k.checked_div(new_quote).ok_or(MathOverflow)?
    base_released = new_base
                        .checked_sub(amm_state.base_asset_reserve).ok_or(MathOverflow)?
    require!(base_released as u64 >= min_base_amount, SlippageExceeded)

// --- State updates ---
10. amm_state.base_asset_reserve = new_base
    amm_state.quote_asset_reserve = new_quote
    if is_long: amm_state.open_interest_long += notional
    else:       amm_state.open_interest_short += notional

11. user_margin_account.free_collateral -= collateral_amount

// --- Populate position ---
12. position.owner = user.key()
    position.position_id = user_margin_account.next_position_id
    position.is_long = is_long
    position.size = base_acquired (or base_released for short) as u64
    position.notional = notional
    position.entry_price = (notional as u128 * 1_000_000 / position.size as u128) as u64
    position.margin = margin_locked
    position.funding_snapshot = amm_state.cumulative_funding_rate
    position.bump = bumps.position

// --- Increment position ID ---
13. user_margin_account.next_position_id += 1
```
### Instruction 4: `close_position`
**Who:** Position owner only.
**Closes:** `Position` PDA (rent returned to user).
**Updates:** `AmmState` reserves, `UserMarginAccount`.
**Transfers:** If net profit, no CPI needed (update free_collateral in-place). USDC remains in vault.

> **Design note for MVP:** Net PnL is tracked as credit in `free_collateral`. Actual USDC withdrawal happens via a separate `withdraw_margin` instruction. This avoids a CPI inside `close_position` and simplifies the instruction.

**Parameters:** None (full close only). Client derives PDA using the correct `position_id`.

**Accounts:**
```rust
user                   [signer]
user_margin_account    PDA [b"margin", user.key()]    mut
position               PDA [b"position", user.key(), position.position_id.to_le_bytes()] mut, close = user
amm_state              PDA [b"amm_state"]              mut
pyth_price_feed        Account<'info, PriceUpdateV2>
```

**Logic:**
```rust
// --- Security ---
1. require!(position.owner == user.key(), Unauthorized)

// --- Funding settlement ---
2. funding_delta = (position.size as i128)
                       .checked_mul(
                           amm_state.cumulative_funding_rate
                               .checked_sub(position.funding_snapshot).ok_or(MathOverflow)?
                       ).ok_or(MathOverflow)?
                       / 1_000_000_000i128

   if position.is_long:
       signed_funding = funding_delta
   else:
       signed_funding = -funding_delta

// --- Reverse vAMM swap ---
3. (LONG close - sell base back)
   new_base  = amm_state.base_asset_reserve
                   .checked_add(position.size as u128).ok_or(MathOverflow)?
   new_quote = amm_state.k.checked_div(new_base).ok_or(MathOverflow)?
   quote_received = amm_state.quote_asset_reserve
                        .checked_sub(new_quote).ok_or(MathOverflow)? as i64

   (SHORT close - buy base back)
   new_base  = amm_state.base_asset_reserve
                   .checked_sub(position.size as u128).ok_or(MathOverflow)?
   new_quote = amm_state.k.checked_div(new_base).ok_or(MathOverflow)?
   quote_paid = new_quote
                    .checked_sub(amm_state.quote_asset_reserve).ok_or(MathOverflow)? as i64

// --- PnL ---
4. (LONG)  realized_pnl = quote_received as i64 - position.notional as i64
   (SHORT) realized_pnl = position.notional as i64 - quote_paid as i64

// --- Fee ---
5. exit_notional = quote_received or quote_paid (absolute)
   trading_fee = exit_notional * amm_state.trading_fee_bps as u64 / 10_000

// --- Net return ---
6. net_return = position.margin as i64
                + realized_pnl
                - signed_funding
                - trading_fee as i64

   let net_return_safe = net_return.max(0) as u64

// --- State updates ---
7. amm_state.base_asset_reserve = new_base
   amm_state.quote_asset_reserve = new_quote
   if position.is_long: amm_state.open_interest_long -= position.notional
   else:                amm_state.open_interest_short -= position.notional

8. // Adjust user collateral
   user_margin_account.collateral =
       (user_margin_account.collateral as i64
        - position.margin as i64
        + net_return_safe as i64).max(0) as u64
   user_margin_account.free_collateral += net_return_safe
```
### Instruction 5: `update_funding`
**Who:** Anyone (permissionless). In MVP, call this from the frontend every hour or on-demand.
**Updates:** `amm_state.cumulative_funding_rate`.

**Parameters:** None.

**Accounts:**
```rust
amm_state          PDA [b"amm_state"]    mut
pyth_price_feed    Account<'info, PriceUpdateV2>
clock              Sysvar<Clock>
```

**Logic:**
```rust
// 1. Get current time
1. now = Clock::get()?.unix_timestamp
// 2. Check if funding period has elapsed
2. require!(now - amm_state.last_funding_ts >= amm_state.funding_period, FundingNotDue)
// 3. Fetch index price
3. index_price = get_index_price(&pyth_price_feed)?
// 4. Calculate mark price
4. mark_price  = amm_state.quote_asset_reserve * 1_000_000 / amm_state.base_asset_reserve
// 5. Calculate funding rate
5. funding_rate = (mark_price as i128 - index_price as i128)
                  * 1_000_000_000i128
                  / index_price as i128
                  / 24i128
// 6. Update cumulative funding rate
6. amm_state.cumulative_funding_rate += funding_rate
// 7. Update last funding timestamp
7. amm_state.last_funding_ts = now
```

If not implemented in time, set `funding_snapshot = 0` and `cumulative_funding_rate = 0` so funding delta is always zero. PnL still works correctly.
### Instruction 6: `liquidate`
**Who:** Anyone (permissionless liquidator).
**Closes:** An undercollateralized position. Pays fee to caller.

**Parameters:**
```rust
pub position_owner: Pubkey
pub position_id: u32
```

**Accounts:**
```rust
liquidator              [signer, mut]
liquidator_usdc         Token account   mut, receives fee
position_owner_margin   PDA [b"margin", position_owner.as_ref()]  mut
position                PDA [b"position", position_owner.as_ref(), position_id.to_le_bytes()] mut, close = liquidator
amm_state               PDA [b"amm_state"]   mut
vault                   Token account   mut
vault_authority         PDA [b"vault_authority"]
pyth_price_feed         Account<'info, PriceUpdateV2>
token_program           Program<Token>
clock                   Sysvar<Clock>
```

**Logic:**
```rust
// 1. Read mark price and settle pending funding
1. Read mark_price (from vAMM) and settle pending funding
// 2. Compute unrealized PnL
2. Compute unrealized_pnl (same as close_position)
// 3. Calculate margin ratio
3. margin_ratio_bps = (position.margin as i64 + unrealized_pnl)
                      * 10_000
                      / position.notional as i64
// 4. Check liquidation condition
4. require!(margin_ratio_bps < amm_state.maint_margin_bps as i64, PositionNotLiquidatable)
// 5. Reverse vAMM swap
5. Perform reverse vAMM swap (same as close_position)
// 6. Calculate liquidation fee
6. liq_fee = position.notional * amm_state.liquidation_fee_bps as u64 / 10_000
// 7. Transfer fee to liquidator
7. CPI: token::transfer { from: vault, to: liquidator_usdc, authority: vault_authority, amount: liq_fee }
// 8. Update margin account
8. Update position_owner_margin.collateral and position_owner_margin.free_collateral
// 9. Update AMM reserves
9. Update amm_state reserves and OI
```
### Instruction 7: `withdraw_margin`
**Who:** Position owner.
**Transfers:** Free USDC from vault to user wallet.

**Parameters:**
```rust
pub amount: u64
```

**Accounts:**
```rust
user                   [signer]
user_margin_account    PDA [b"margin", user.key()]    mut, has_one = owner (user)
user_usdc_account      Token account   mut
vault                  Token account   mut
vault_authority        PDA [b"vault_authority"]
amm_state              PDA [b"amm_state"]
token_program          Program<Token>
```

**Logic:**
```rust
// 1. Validate withdrawal amount
1. require!(amount > 0)
// 2. Ensure enough free collateral
2. require!(amount <= user_margin_account.free_collateral, WithdrawalExceedsAvailable)
// 3. Transfer tokens back to user
3. CPI: token::transfer { from: vault, to: user_usdc_account, authority: vault_authority, amount }
// 4. Deduct from free collateral
4. user_margin_account.free_collateral -= amount
// 5. Deduct from total collateral
5. user_margin_account.collateral -= amount
```

## 4. Custom Errors

```rust
#[error_code]
pub enum KonahrikError {
    #[msg("Invalid leverage. Must be 1-10.")]
    InvalidLeverage,
    #[msg("Insufficient margin.")]
    InsufficientMargin,
    #[msg("Insufficient margin to cover fees.")]
    InsufficientMarginForFee,
    #[msg("Insufficient amount.")]
    InsufficientAmount,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Slippage tolerance exceeded.")]
    SlippageExceeded,
    #[msg("Oracle price is stale.")]
    OracleStaleness,
    #[msg("Oracle confidence too wide.")]
    OracleConfidence,
    #[msg("Position is not liquidatable.")]
    PositionNotLiquidatable,
    #[msg("Funding period has not elapsed.")]
    FundingNotDue,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Withdrawal exceeds free collateral.")]
    WithdrawalExceedsAvailable,
    #[msg("Insufficient liquidity in vAMM.")]
    InsufficientLiquidity,
}
```

## 5. Pyth Oracle Integration
### 5.1 Cargo dependency

```toml
# programs/konahrik/Cargo.toml
[dependencies]
anchor-lang = { version = "1.0.1", features = ["init-if-needed"] }
anchor-spl  = "1.0.1"
pyth-solana-receiver-sdk = "0.4.0"

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```
### 5.2 Price reader helper (place in `src/oracle.rs`)

```rust
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, get_feed_id_from_hex};
use crate::errors::KonahrikError;

pub const SOL_USD_FEED_ID: &str =
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const STALENESS_THRESHOLD_SECS: u64 = 60;

pub fn get_index_price(price_update: &Account<'_, PriceUpdateV2>) -> Result<u64> {
    let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID)
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;

    let price = price_update
        .get_price_no_older_than(&Clock::get()?, STALENESS_THRESHOLD_SECS, &feed_id)
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;

    require!(
        price.conf < price.price.unsigned_abs() / 100,
        KonahrikError::OracleConfidence
    );

    let price_u64 = pyth_price_to_u64(price.price, price.exponent)?;
    Ok(price_u64)
}

fn pyth_price_to_u64(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, KonahrikError::OracleStaleness);
    let price_u = price as u64;
    let target: i32 = -6;
    let diff = exponent - target;

    if diff >= 0 {
        price_u
            .checked_div(10u64.pow(diff as u32))
            .ok_or(error!(KonahrikError::MathOverflow))
    } else {
        price_u
            .checked_mul(10u64.pow((-diff) as u32))
            .ok_or(error!(KonahrikError::MathOverflow))
    }
}
```
### 5.3 Devnet price feed account

|**Feed**|**Devnet Address (sponsored - always fresh)**|
|---|---|
|SOL/USD|`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`|
Pass this address as `pyth_price_feed` in all instruction calls. No manual Hermes posting needed on devnet.

## 6. Repository Structure

```markdown
konahrik/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   └── konahrik/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs              ← declare_id! + #[program] module + all instruction routing
│           ├── errors.rs           ← KonahrikError enum
│           ├── oracle.rs           ← get_index_price helper
│           ├── state.rs            ← AmmState, UserMarginAccount, Position structs
│           └── instructions/
│               ├── mod.rs
│               ├── initialize_amm.rs
│               ├── deposit_margin.rs
│               ├── open_position.rs
│               ├── close_position.rs
│               ├── update_funding.rs   ← [stretch]
│               ├── liquidate.rs        ← [stretch]
│               └── withdraw_margin.rs
├── tests/
│   └── konahrik.ts
└── app/                            <- Next.js frontend
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   └── page.tsx
        ├── components/
        │   ├── WalletButton.tsx        ← wallet adapter connect button
        │   ├── AmmStats.tsx            ← mark price, index price, OI, funding rate
        │   ├── MarginPanel.tsx         ← deposit/withdraw margin UI
        │   ├── TradingPanel.tsx        ← open/close position form
        │   └── PositionCard.tsx        ← current position display + PnL
        └── lib/
            ├── constants.ts            ← PROGRAM_ID, feed addresses, demo params
            ├── anchor-client.ts        ← provider, program, PDA helpers
            ├── pyth-client.ts          ← Hermes REST for live price display
            └── math.ts                 ← client-side liq price + PnL calculations
```

## 7. Precision and Scaling Reference
Every number in the program uses one of these scales. Never mix scales inside a single arithmetic operation.

|**Value Type**|**Rust Type**|**Scale**|**Example**|
|---|---|---|---|
|USDC amounts (collateral, notional)|`u64`|1e6|$1.00 = 1_000_000|
|Virtual SOL reserve|`u128`|1e9|1M SOL = 1_000_000_000_000_000|
|Virtual USDC reserve|`u128`|1e6|140M USDC = 140_000_000_000_000|
|k (product of reserves)|`u128`|-|fits in u128|
|Prices|`u64`|1e6|$140.00 = 140_000_000|
|Funding rate|`i128`|1e9|0.01% hourly = 100_000|
|Basis point ratios|`u16`|1e4|10% = 1000|
**Rule:** All intermediate AMM math (`k / new_quote`, `base * quote`) must use `u128`. Cast to `u64` only at the final assignment to a struct field.

## 8. Anchor.toml

```toml
[features]
seeds = false
skip-lint = false

[programs.devnet]
konahrik = "PLACEHOLDER_UPDATE_AFTER_ANCHOR_BUILD"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[toolchain]
anchor_version = "1.0.1"
solana_version = "3.1.10"
package_manager = "yarn"

[scripts]
test = "yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[surfpool]
online = false
```

## 9. Frontend - Component Contracts

### `app/package.json`
```json
{
  "dependencies": {
    "next": "16.2.x",
    "@anchor-lang/core": "^1.0.1",
    "@solana/web3.js": "^1.98.x"
  }
}
```

### `app/next.config.js`
```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack is on by default in Next.js 16 - no experimental flag needed
  // No changes required for wallet adapter or Anchor client compatibility
};

module.exports = nextConfig;
```

### `app/src/lib/constants.ts`
```typescript
import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID        = new PublicKey("PLACEHOLDER");
export const PYTH_SOL_USD_FEED = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const DEVNET_RPC        = "https://api.devnet.solana.com";

// Demo AMM initial params (must match what initialize_amm was called with)
export const INITIAL_BASE_RESERVE  = 1_000_000n * 1_000_000_000n; // 1M virtual SOL
export const INITIAL_QUOTE_RESERVE = 140_000_000n * 1_000_000n;   // 140M virtual USDC
```

### `app/src/lib/anchor-client.ts`
```typescript
import { AnchorProvider, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { IDL, type Konahrik } from "../types/konahrik";  // generated by anchor build
import { PROGRAM_ID, DEVNET_RPC } from "./constants";

export const getProvider = (wallet: AnchorWallet) =>
  new AnchorProvider(new Connection(DEVNET_RPC, "confirmed"), wallet, {
    commitment: "confirmed",
  });

export const getProgram = (wallet: AnchorWallet): Program<Konahrik> =>
  new Program(IDL, PROGRAM_ID, getProvider(wallet));

export const getAmmStatePDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("amm_state")], PROGRAM_ID);

export const getMarginPDA = (user: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("margin"), user.toBuffer()], PROGRAM_ID);

export const getPositionPDA = (user: PublicKey, positionId: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(positionId, 0);
  return PublicKey.findProgramAddressSync([Buffer.from("position"), user.toBuffer(), buffer], PROGRAM_ID);
};

export const getVaultAuthorityPDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("vault_authority")], PROGRAM_ID);
```

### `app/src/lib/math.ts` (client-side only, not on-chain)
```typescript
// All values in micro-units matching program precision

export const SCALE = 1_000_000n; // 1e6

export function getMarkPrice(baseReserve: bigint, quoteReserve: bigint): number {
  return Number((quoteReserve * SCALE) / baseReserve) / 1_000_000;
}

export function getLiquidationPrice(
  entryPrice: number,
  isLong: boolean,
  initialMarginBps: number,
  maintMarginBps: number
): number {
  const buffer = (initialMarginBps - maintMarginBps) / 10_000;
  return isLong
    ? entryPrice * (1 - buffer)
    : entryPrice * (1 + buffer);
}

export function getUnrealizedPnl(
  isLong: boolean,
  entryPrice: number,
  markPrice: number,
  sizeInSOL: number  // position.size / 1e9
): number {
  return isLong
    ? (markPrice - entryPrice) * sizeInSOL
    : (entryPrice - markPrice) * sizeInSOL;
}

export function getMarginRatio(
  marginUsdc: number,
  unrealizedPnl: number,
  notionalUsdc: number
): number {
  return (marginUsdc + unrealizedPnl) / notionalUsdc;
}
```

## 10. TypeScript Integration Tests (`tests/konahrik.ts`)
Tests run against Surfpool locally. Ensure `cargo install surfpool` is available.

```typescript
describe("Konahrik MVP", () => {
  // Setup: create mint, mint USDC to test wallets

  it("initialize_amm: AmmState created with correct reserves", async () => {
    // Verify base * quote == k
    // Verify mark price = quote / base ≈ $140
  });

  it("deposit_margin: USDC moves from user to vault", async () => {
    // Verify vault balance increased
    // Verify UserMarginAccount.free_collateral = deposited amount
  });

  it("open_position LONG: reserves update, position created", async () => {
    // open 10x long, 10 USDC margin → 100 USDC notional
    // Verify: quote_reserve increased by ~100, base_reserve decreased
    // Verify: mark price increased (price impact)
    // Verify: position.entry_price set correctly
    // Verify: free_collateral decreased by 10 USDC
  });

  it("close_position LONG with profit: PnL credited to margin", async () => {
    // Use a second wallet to push price up (open another long)
    // Close original long
    // Verify: free_collateral > original (profit recorded)
    // Verify: Position account closed (returns rent)
  });

  it("open_position SHORT: reserves update correctly", async () => {
    // Verify: quote_reserve decreased, base_reserve increased
    // Verify: mark price decreased
  });

  it("withdraw_margin: transfers USDC from vault to wallet", async () => {
    // Verify vault balance decreased
    // Verify user wallet USDC increased
  });

  it("SECURITY: close_position fails if wrong signer", async () => {
    // Use a different keypair to try to close another user's position
    // Expect: Unauthorized error
  });

  it("SECURITY: open_position with leverage > 10 fails", async () => {
    // Expect: InvalidLeverage error
  });
});
```

## 11. Initialization Script (`scripts/init.ts`)
Run once after deployment to set up the AMM.

```typescript
import * as anchor from "@anchor-lang/core";
import { getProgram, getAmmStatePDA, getVaultAuthorityPDA } from "../app/src/lib/anchor-client";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { DEVNET_RPC, PYTH_SOL_USD_FEED } from "../app/src/lib/constants";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Konahrik as anchor.Program;
  
  // On devnet, use a real USDC devnet mint OR create a test mint
  // Real devnet USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (mainnet)
  // For demo: create a local test mint so you can airdrop freely
  const usdcMint = await createMint(provider.connection, provider.wallet.payer, /*...*/);
  const [ammStatePDA] = getAmmStatePDA();
  const [vaultAuthority] = getVaultAuthorityPDA();
  
  // Create vault token account
  const vault = await getOrCreateAssociatedTokenAccount(/*...*/);

  await program.methods
    .initializeAmm({
      initialBaseReserve: new anchor.BN("1000000000000000"),   // 1M SOL * 1e9
      initialQuoteReserve: new anchor.BN("140000000000000"),   // 140M USDC * 1e6 → $140 start price
      initialMarginBps: 1000,
      maintMarginBps: 625,
      liquidationFeeBps: 250,
      tradingFeeBps: 10,
      fundingPeriod: new anchor.BN(3600),
    })
    .accounts({
      authority: provider.wallet.publicKey,
      ammState: ammStatePDA,
      vault: vault.address,
      vaultAuthority,
      usdcMint,
      pythFeed: PYTH_SOL_USD_FEED,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("AMM initialized. AmmState:", ammStatePDA.toBase58());
}

main();
```

## 12. Day-by-Day Build Plan
### Day 1
- [ ] `anchor init konahrik`, configure `Anchor.toml`
- [ ] Write `state.rs`: all three account structs
- [ ] Write `errors.rs`
- [ ] Write `oracle.rs`
- [ ] Implement `initialize_amm` + `deposit_margin`
- [ ] Write and pass tests for both instructions
- [ ] Run `scripts/init.ts` on devnet
### Day 2
- [ ] Implement `open_position` (LONG and SHORT branches, handle `position_id`)
- [ ] Implement `close_position`
- [ ] Write and pass tests for open + close with profit/loss scenarios
- [ ] Verify PnL math with manual calculations
### Day 3
- [ ] Implement `withdraw_margin`
- [ ] `anchor build` → copy IDL and types to `app/src/types/`
- [ ] Set up Next.js app with wallet adapter
- [ ] Build `AmmStats` component polling `AmmState` on-chain
- [ ] Build `MarginPanel` (deposit flow)
### Day 4
- [ ] Build `TradingPanel` (open position flow with live entry price preview)
- [ ] Build `PositionCard` (live unrealized PnL, liquidation price)
- [ ] Connect close position button
- [ ] End-to-end demo loop working in browser
### Day 5 (buffer / stretch)
- [ ] Implement `update_funding` and `liquidate`
- [ ] Polish UI (loading states, error toasts, transaction confirmation feedback)
- [ ] Record demo video
## 13. Security Checklist (Pre-Demo Audit)

|**Check**|**Instruction**|**How**|
|---|---|---|
|Signer is owner of margin account|`open_position`, `close_position`, `withdraw_margin`|`has_one = owner` constraint or `require!(account.owner == user.key())`|
|Signer is owner of position|`close_position`|`require!(position.owner == user.key(), Unauthorized)`|
|Vault authority is correct PDA|`withdraw_margin`, `liquidate`|`seeds = [b"vault_authority"], bump` on vault authority account|
|Vault mint matches amm_state.usdc_mint|`deposit_margin`, `withdraw_margin`|`constraint = vault.mint == amm_state.usdc_mint`|
|Oracle account is owned by Pyth program|All reads|`Account<'info, PriceUpdateV2>` enforces program ownership automatically|
|Oracle not stale|`open_position`, `close_position`, `liquidate`|`get_price_no_older_than` with 60s threshold|
|Leverage in bounds|`open_position`|`require!(leverage >= 1 && leverage <= 10)`|
|All AMM math uses checked arithmetic|`open_position`, `close_position`, `liquidate`|`.checked_add`, `.checked_sub`, `.checked_mul`, `.checked_div` throughout|
|No duplicate position open|`open_position`|Anchor `init` on Position PDA - handled by incrementing `position_id`|
|Withdrawal does not exceed free collateral|`withdraw_margin`|`require!(amount <= free_collateral)`|
|Program ID in `declare_id!` matches keypair|`anchor build`|Anchor 1.0.1 validation check|

## 14. What This Is NOT (Out of Scope - Do Not Implement)
The following must not be scaffolded. They are listed here so the agent does not add them speculatively:

- Partial position close
- Multi-market / market factory
- Token 2022 for the USDC mint
- Keeper bot or crank automation
- Fee distribution to a staking program
- DAO governance of AMM parameters
- TWAP oracle for mark price
- Insurance fund withdrawal mechanism
- On-chain price history storage
- WebSocket subscriptions in the frontend (polling every 3s is sufficient for demo)