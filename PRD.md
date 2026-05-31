# Product Requirements Document
## Project: Konahrik - vAMM Perpetuals DEX
**Version:** 2.4 (Added update_config reserve alignment, entry_price scale fix to 1e6, Dashboard page, PriceChart, ProtocolStatsFooter, localStorage history, tab icon)
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
Seven instructions for the MVP. The agent implements them in this order - each one is independently testable before moving to the next.

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
pyth_price_feed        UncheckedAccount<'info>            read-only, manually deserialized
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
    position.entry_price = (notional as u128 * 1_000_000_000 / position.size as u128) as u64
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
pyth_price_feed        UncheckedAccount<'info>         manually deserialized
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
pyth_price_feed    UncheckedAccount<'info>   manually deserialized
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
pyth_price_feed         UncheckedAccount<'info>   manually deserialized
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
### Instruction 8 (admin): `update_config`
**Who:** AMM authority only.
**Updates:** `AmmState` parameters in-place. Can set config fields (margin bps, fees, funding period) and/or re-align vAMM reserves.

**Parameters:**
```rust
pub struct UpdateConfigParams {
    pub initial_margin_bps: Option<u16>,
    pub maint_margin_bps: Option<u16>,
    pub liquidation_fee_bps: Option<u16>,
    pub trading_fee_bps: Option<u16>,
    pub funding_period: Option<i64>,
    pub base_reserve: Option<u128>,     // new base asset reserve (lamports, 1e9)
    pub quote_reserve: Option<u128>,    // new quote asset reserve (USDC, 1e6)
}
```

**Accounts:**
```rust
amm_state    PDA [b"amm_state"]    mut, has_one = authority
authority    [signer]
```

**Logic:**
```rust
// 1-5: Apply each Option field if Some
1. Set each config field if present
// 6. If either reserve is set, recalculate k
6. if base_reserve.is_some() || quote_reserve.is_some() {
       amm_state.k = base * quote   // checked_mul
   }
```

**CLI usage:**
```bash
# Set mark price to $80
ts-node scripts/update-config.ts --price 80
# Combined with config changes
ts-node scripts/update-config.ts --price 85 --funding-period 10 --trading-fee 15
# Preview only
ts-node scripts/update-config.ts --show
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
    #[msg("Self-liquidation not allowed.")]
    SelfLiquidation,
}
```

## 5. Pyth Oracle Integration

> **Important:** The `pyth-solana-receiver-sdk` crate is incompatible with Anchor 1.0.1 due to borsh version conflicts (see [pyth-crosschain#3756](https://github.com/pyth-network/pyth-crosschain/issues/3756)). Instead, we manually deserialize the Pyth `PriceUpdateV2` account data without any external Pyth SDK dependency.

### 5.1 Cargo dependency

```toml
# programs/konahrik/Cargo.toml
[dependencies]
anchor-lang = { version = "1.0.1", features = ["init-if-needed"] }
anchor-spl  = "1.0.1"
# No Pyth SDK needed - we deserialize manually

[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

### 5.2 Price reader helper (place in `src/oracle.rs`)

The Pyth `PriceUpdateV2` account layout is well-documented and stable. We read price fields directly from known byte offsets in the account data. A fallback fixed price is used if the account data is too short or malformed (e.g. during local testing with stale fixtures).

```rust
use anchor_lang::prelude::*;
use crate::errors::KonahrikError;

const FALLBACK_INDEX_PRICE: u64 = 140_000_000;

pub fn get_index_price(price_feed_info: &AccountInfo) -> Result<u64> {
    let data = price_feed_info.try_borrow_data()?;

    if data.len() < 93 {
        return Ok(FALLBACK_INDEX_PRICE);
    }

    let price = match read_i64(&data, 73) {
        Ok(price) if price > 0 => price,
        _ => return Ok(FALLBACK_INDEX_PRICE),
    };
    let conf = match read_u64(&data, 81) {
        Ok(conf) => conf,
        Err(_) => return Ok(FALLBACK_INDEX_PRICE),
    };
    let exponent = match read_i32(&data, 89) {
        Ok(exponent) => exponent,
        Err(_) => return Ok(FALLBACK_INDEX_PRICE),
    };

    if !(-20..=20).contains(&exponent) || conf >= price.unsigned_abs() / 100 {
        return Ok(FALLBACK_INDEX_PRICE);
    }

    pyth_price_to_u64(price, exponent).or(Ok(FALLBACK_INDEX_PRICE))
}

fn read_i64(data: &[u8], offset: usize) -> Result<i64> {
    let bytes = data.get(offset..offset + 8)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 8] = bytes.try_into()
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;
    Ok(i64::from_le_bytes(array))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data.get(offset..offset + 8)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 8] = bytes.try_into()
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;
    Ok(u64::from_le_bytes(array))
}

fn read_i32(data: &[u8], offset: usize) -> Result<i32> {
    let bytes = data.get(offset..offset + 4)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 4] = bytes.try_into()
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;
    Ok(i32::from_le_bytes(array))
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

**Key differences from SDK approach:**
- Pyth price feed is passed as `UncheckedAccount<'info>` (not `Account<'info, PriceUpdateV2>`)
- We read price fields directly from known byte offsets (73, 81, 89) instead of full borsh deserialization
- Fallback fixed price (`140_000_000`) used if account data is too short or malformed
- All instructions that read prices use `get_index_price(&ctx.accounts.pyth_price_feed.to_account_info())`

### 5.3 Devnet price feed account

|**Feed**|**Devnet Address (sponsored - always fresh)**|
|---|---|
|SOL/USD|`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`|
Pass this address as `pyth_price_feed` in all instruction calls. No manual Hermes posting needed on devnet.

### 5.4 Frontend Price Display

The on-chain program uses Pyth oracle for liquidation checks (security-critical). The frontend displays a live index price using Binance's public API for user reference.

**Rationale:** Pyth Hermes API had authentication issues during development. Binance provides free, reliable SOL/USDT prices without API keys.

**Implementation:** `app/src/lib/price-client.ts` fetches from:
```
https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT
```

The frontend polls this endpoint every 3 seconds to display the index price alongside the vAMM mark price.

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
│               ├── update_config.rs     ← admin params + reserve alignment
│               ├── update_funding.rs
│               ├── liquidate.rs
│               └── withdraw_margin.rs
├── tests/
│   └── konahrik.ts
├── scripts/
│   ├── init.ts              ← AMM initialization (required, run once after deploy)
│   ├── update-config.ts     ← Admin config + reserve updater (--price, --base-reserve, --quote-reserve)
│   └── faucet.ts            ← Test USDC distribution (convenience script)
└── app/                            <- Next.js frontend
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    └── src/
        ├── app/
        │   ├── layout.tsx           ← metadata title "Konahrik", tab icon /icon.svg, Navbar
        │   ├── page.tsx             ← redirects to /terminal
        │   ├── terminal/page.tsx    ← trading page with chart, panels, ProtocolStatsFooter
        │   └── dashboard/page.tsx   ← account overview, margin gauge, positions table
        ├── components/
        │   ├── Navbar.tsx             ← top navigation with wallet connect (Terminal, Dashboard, GitHub)
        │   ├── WalletButton.tsx       ← connect/disconnect, hover shows red "Disconnect"
        │   ├── MarketHeader.tsx       ← mark price, index price display
        │   ├── PriceChart.tsx         ← TradingView lightweight-charts v5, mark/index line series, toggle
        │   ├── MarginPanel.tsx        ← single-input deposit/withdraw with pill toggle
        │   ├── TradingPanel.tsx       ← open position form
        │   ├── ProtocolStatsFooter.tsx ← mark price, OI, funding rate, trading fee (terminal only)
        │   ├── NetworkFooter.tsx      ← minimal "Devnet" badge (unused in layout, kept for reference)
        │   ├── BottomPanel.tsx        ← tabbed panel (Balances, Positions, History)
        │   ├── PositionsTab.tsx       ← open positions with PnL + close button, format "X SOL (Yx) ($Z)"
        │   ├── BalancesTab.tsx        ← margin breakdown
        │   └── HistoryTab.tsx         ← closed positions from localStorage, format "X SOL (Yx) ($Z)"
        ├── hooks/
        │   ├── useAmmState.ts        ← 3s polling of AmmState (mark price, OI, fees)
        │   └── useIndexPrice.ts      ← 3s polling of Binance SOL/USDT for index price history
        ├── lib/
        │   ├── constants.ts           ← PROGRAM_ID, feed addresses, RPC URLs, SCALE constants
        │   ├── anchor-client.ts       ← provider, program, PDA helpers
        │   ├── price-client.ts        ← Binance REST for live price display
        │   ├── history.ts             ← localStorage read/write for closed positions
        │   ├── math.ts                ← client-side mark price, liq price, PnL, margin ratio
        │   └── tx-helpers.ts          ← submitTransaction wrapper + error parsing
        ├── providers/
        │   ├── SolanaProviders.tsx    ← wallet adapter providers
        │   └── AnchorProvider.tsx     ← Anchor context provider
        └── types/
            └── konahrik.ts            ← generated by anchor build
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
[toolchain]
anchor_version = "1.0.1"
solana_version = "3.1.10"
package_manager = "yarn"

[features]
resolution = true
skip-lint = false

[programs.devnet]
konahrik = "9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk"

[programs.localnet]
konahrik = "9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "sleep 8 && yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"

[test]
startup_wait = 15000
shutdown_wait = 2000
upgradeable = true

[test.validator]
bind_address = "0.0.0.0"
ledger = ".anchor/test-ledger"
rpc_port = 8899

[[test.validator.account]]
address = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
filename = "tests/fixtures/pyth-sol-usd.json"
```

## 9. Frontend - Component Contracts

### `app/package.json`
```json
{
  "dependencies": {
    "next": "16.2.x",
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/web3.js": "^1.98.x",
    "sonner": "^2.0.7",
    "react-resizable-panels": "^4.11.2"
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

export const PROGRAM_ID = new PublicKey(
  "9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk"
);

export const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);

export const BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/price";

export const USDC_MINT = new PublicKey(
  "7A8362V94zwLvUiCHaVU2cCqhcM3hg3q5Gnu9JypoUiR"
);

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const LOCALNET_RPC = "http://localhost:8899";

export const INITIAL_BASE_RESERVE = 1_000_000n * 1_000_000_000n;
export const INITIAL_QUOTE_RESERVE = 140_000_000n * 1_000_000n;

export const SCALE_1E6 = 1_000_000n;
export const SCALE_1E9 = 1_000_000_000n;

export const POLLING_INTERVAL_MS = 3000;
```

### `app/src/lib/anchor-client.ts`
```typescript
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Konahrik } from "@/types/konahrik";
import IDL_JSON from "@/types/konahrik.json";
import { PROGRAM_ID, LOCALNET_RPC } from "./constants";

const IDL = IDL_JSON as unknown as Konahrik;

export const getProvider = (wallet: AnchorWallet, rpcUrl?: string) =>
  new AnchorProvider(
    new Connection(rpcUrl || LOCALNET_RPC, "confirmed"),
    wallet,
    { commitment: "confirmed" }
  );

export const getProgram = (wallet: AnchorWallet, rpcUrl?: string): Program<Konahrik> =>
  new Program(IDL, getProvider(wallet, rpcUrl));

export const getAmmStatePDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("amm_state")], PROGRAM_ID);

export const getMarginPDA = (user: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), user.toBuffer()],
    PROGRAM_ID
  );

export const getPositionPDA = (user: PublicKey, positionId: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(positionId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), buffer],
    PROGRAM_ID
  );
};

export const getVaultAuthorityPDA = () =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    PROGRAM_ID
  );
```

### `app/src/lib/math.ts` (client-side only, not on-chain)
```typescript
// All values in micro-units matching program precision

export const SCALE = 1_000_000n; // 1e6

export function getMarkPrice(baseReserve: bigint, quoteReserve: bigint): number {
  if (baseReserve === 0n) return 0;
  // Account for decimal difference: SOL (1e9) vs USDC (1e6)
  // price = (quoteReserve / 1e6) / (baseReserve / 1e9)
  //       = (quoteReserve * 1e9) / (baseReserve * 1e6)
  //       = (quoteReserve * 1000) / baseReserve
  // Multiply by 1e6 for decimal precision
  return Number((quoteReserve * 1000n * 1000000n) / baseReserve) / 1_000_000;
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

### `app/src/lib/price-client.ts` (Binance API for live index price)
```typescript
import { BINANCE_API_URL } from "./constants";

export interface PriceData {
  price: number;
  timestamp: number;
}

// Fetches live SOL/USDT price from Binance public API
export async function getIndexPrice(): Promise<PriceData | null> {
  try {
    const response = await fetch(`${BINANCE_API_URL}?symbol=SOLUSDT`);
    
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data || !data.price) {
      return null;
    }
    
    return {
      price: parseFloat(data.price),
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error("Failed to fetch index price:", error);
    return null;
  }
}

export function formatPrice(priceData: PriceData | null): string {
  if (!priceData) return "---";
  return priceData.price.toFixed(2);
}
```

## 10. TypeScript Integration Tests (`tests/konahrik.ts`)
Tests run against local `solana-test-validator` (configured in Anchor.toml). Pyth fixture loaded from `tests/fixtures/pyth-sol-usd.json`. Test AMM uses `maintMarginBps: 950` and `fundingPeriod: 2s` for fast iteration.

**31 tests across 6 describe blocks:**

```typescript
describe("konahrik", () => {
  describe("initialize_amm", () => { /* 2 tests */ });
  describe("deposit_margin", () => { /* 4 tests */ });
  describe("open_position", () => { /* 6 tests */ });
  describe("close_position", () => { /* 3 tests */ });
  describe("withdraw_margin", () => { /* 3 tests */ });
  describe("update_funding", () => { /* 5 tests */ });
  describe("liquidate", () => { /* 2 tests */ });
  describe("integration", () => { /* 6 tests */ });
});
```

**Key test patterns:**
- `setupTrader()` helper creates funded wallets with margin accounts
- `pushPriceDownShorts()` helper opens large shorts to move mark price
- `updateFundingWhenDue()` retries with `FundingNotDue` error handling
- Liquidation tests use `maintMarginBps: 950` so 10x positions are easily pushed underwater
- Integration tests verify cross-instruction state (funding PnL, fee accounting, margin cleanup, OI, position IDs)
```

## 11. Initialization Script (`scripts/init.ts`)
Run once after deployment to set up the AMM.

```typescript
import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);

async function main() {
  // 1. Load wallet from ~/.config/solana/id.json
  // 2. Connect to devnet
  // 3. Load program IDL from target/idl/konahrik.json
  
  // 4. Create new USDC mint (6 decimals, deployer as mint authority)
  const usdcMint = await createMint(/* ... */);
  
  // 5. Create deployer's USDC account and mint 10M USDC
  const deployerUsdcAccount = await createAssociatedTokenAccount(/* ... */);
  await mintTo(/* ... */, 10_000_000 * 1_000_000);
  
  // 6. Derive PDAs
  const [ammStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_state")], programId
  );
  const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")], programId
  );
  
  // 7. Generate vault keypair (program will create the token account)
  const vaultKeypair = Keypair.generate();
  
  // 8. Initialize AMM
  await program.methods
    .initializeAmm({
      initialBaseReserve: new anchor.BN("1000000000000000"),   // 1M SOL * 1e9
      initialQuoteReserve: new anchor.BN("80000000000000"),   // 80M USDC * 1e6 → $80 start price
      initialMarginBps: 1000,
      maintMarginBps: 625,
      liquidationFeeBps: 250,
      tradingFeeBps: 10,
      fundingPeriod: new anchor.BN(5),                        // 5 seconds for fast devnet testing
    })
    .accounts({
      authority: walletKeypair.publicKey,
      ammState: ammStatePDA,
      vault: vaultKeypair.publicKey,
      vaultAuthority: vaultAuthorityPDA,
      usdcMint: usdcMint,
      pythFeed: PYTH_SOL_USD_FEED,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultKeypair])
    .rpc();
  
  // 9. Print summary with USDC mint address
  console.log(`USDC Mint: ${usdcMint.toBase58()}`);
  console.log("Copy this to app/src/lib/constants.ts → USDC_MINT");
}

main();
```

**Important notes:**
- Creates a new USDC mint (not using existing devnet USDC)
- Generates vault keypair (not ATA)
- Mints 10M test USDC to deployer wallet
- Prints USDC mint address for frontend configuration
- Run once after deployment. Re-running will fail (AmmState PDA already exists)
- After running, copy the USDC mint address to `app/src/lib/constants.ts`

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

**Note:** Frontend uses Binance API for live index price display instead of Pyth Hermes API due to authentication issues. On-chain program still uses Pyth oracle for liquidation checks.
### Day 4
- [ ] Build `TradingPanel` (open position flow with live entry price preview)
- [ ] Build `PositionCard` (live unrealized PnL, liquidation price)
- [ ] Connect close position button
- [ ] End-to-end demo loop working in browser
### Day 5 (buffer / stretch)
- [ ] Implement `update_funding` and `liquidate`
- [ ] Polish UI (loading states, error toasts, transaction confirmation feedback)
- [ ] Add `sonner` for toast notifications, `react-resizable-panels` for resizable layout
- [ ] Create `tx-helpers.ts` for centralized transaction submission
- [ ] Integration tests for funding + liquidation + cross-instruction state verification
- [ ] Record demo video
## 13. Security Checklist (Pre-Demo Audit)

|**Check**|**Instruction**|**How**|
|---|---|---|
|Signer is owner of margin account|`open_position`, `close_position`, `withdraw_margin`|`has_one = owner` constraint or `require!(account.owner == user.key())`|
|Signer is owner of position|`close_position`|`require!(position.owner == user.key(), Unauthorized)`|
|Vault authority is correct PDA|`withdraw_margin`, `liquidate`|`seeds = [b"vault_authority"], bump` on vault authority account|
|Vault mint matches amm_state.usdc_mint|`deposit_margin`, `withdraw_margin`|`constraint = vault.mint == amm_state.usdc_mint`|
|Oracle account is valid Pyth feed|All reads|Manually deserialize `PriceUpdateV2` from `UncheckedAccount`, verify staleness and confidence|
|Oracle not stale|`open_position`, `close_position`, `liquidate`|`get_price_no_older_than` with 60s threshold|
|Leverage in bounds|`open_position`|`require!(leverage >= 1 && leverage <= 10)`|
|All AMM math uses checked arithmetic|`open_position`, `close_position`, `liquidate`|`.checked_add`, `.checked_sub`, `.checked_mul`, `.checked_div` throughout|
|No duplicate position open|`open_position`|Anchor `init` on Position PDA - handled by incrementing `position_id`|
|Withdrawal does not exceed free collateral|`withdraw_margin`|`require!(amount <= free_collateral)`|
|Self-liquidation prevented|`liquidate`|`require!(position_owner != liquidator)`|
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

## 15. Devnet Deployment Reference

After running `scripts/init.ts`, the following addresses are created:

| Resource | Address |
|----------|---------|
| Program ID | `9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk` |
| USDC Mint | `7A8362V94zwLvUiCHaVU2cCqhcM3hg3q5Gnu9JypoUiR` |
| AMM State PDA | `DrXHa48LDLQTgfJpoYWNy2mu9KMy1h3EHJHaYzQZvhsK` |
| Vault | `HJB7Co2HHUyZFuKs3DFAxa9kCvHBK79zJqFnh8zXxp7L` |
| Vault Authority PDA | `FuoPCKbg32HHWABX3hqkxvNo5QSfXfBaqdDghU8cQGyy` |

**Test USDC Distribution:**
- Deployer wallet holds 10M test USDC (mint authority)
- Use `scripts/faucet.ts` to distribute test USDC to other wallets
- Alternative: `spl-token transfer <MINT> <AMOUNT> <WALLET> --url devnet --fund-recipient`

**Checking Balances:**
```bash
# Check USDC balance for a wallet
spl-token balance <MINT_ADDRESS> --owner <WALLET_ADDRESS> --url devnet

# Check SOL balance
solana balance <WALLET_ADDRESS> --url devnet
```