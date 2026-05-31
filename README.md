# Konahrik

**Virtual AMM perpetual futures trading terminal on Solana.**

Konahrik is a fully on-chain perpetual futures exchange powered by a virtual automated market maker (vAMM). Trade SOL-PERP with up to 10× leverage, monitor positions on a real-time dashboard, and settle funding payments entirely on-chain.

[Live Demo](https://konahrik.vercel.app)

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [vAMM Mechanics](#vamm-mechanics)
- [Smart Contract](#smart-contract)
- [Tech Stack](#tech-stack)
- [Configuration Reference](#configuration-reference)
- [Local Development](#local-development)
  - [Localnet (Full Local Development)](#localnet-full-local-development)
  - [Devnet (Test Against Live Network)](#devnet-test-against-live-network)
- [Scripts](#scripts)
- [Deployment Guide](#deployment-guide)
- [Precision Notes](#precision-notes)
- [License](#license)

## Features

- **vAMM (Virtual AMM)** — Constant-product bonding curve (`k = base × quote`) with no real token reserves. All position pricing, PnL, and liquidation are computed inside the Solana program.
- **Leverage up to 10×** — Choose any leverage from 1× to 10× per position.
- **Mark / Index Price Chart** — Dual-line chart displaying the vAMM mark price (solid green) alongside the live Binance index price (dashed indigo) using TradingView's `lightweight-charts` v5.
- **Funding Rate** — 8-hour-style funding paid between longs and shorts, computed as `(mark − index) / index / 24` per funding period.
- **Liquidation Engine** — Positions are liquidated when margin ratio falls below maintenance margin (6.25% by default). On-chain checks using the vAMM mark price.
- **Dashboard** — Account overview with total value, unrealized PnL, free collateral, a margin risk gauge, and an active positions table.
- **Position History** — Closed positions saved to browser localStorage with size, entry price, and PnL in the format `X SOL (Yx) ($Z)`.
- **On-Chain Entry Price** — Entry price stored at 1e6 precision: `entry_price = notional × 1_000_000_000 / size`.
- **Real-Time Polling** — Both on-chain AMM state and Binance index price are polled every 3 seconds.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Next.js Frontend                    │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ Terminal │  │   Dashboard  │  │  Price Chart   │ │
│  │  Page    │  │    Page      │  │  (lightweight-  │ │
│  │          │  │              │  │   charts v5)    │ │
│  └────┬─────┘  └──────┬───────┘  └────────────────┘ │
│       │               │                              │
│  ┌────▼───────────────▼───────────────────────────┐  │
│  │         @anchor-lang/core Client               │  │
│  │  (useAmmState, PositionsTab, MarginPanel, ...) │  │
│  └────────────────────┬───────────────────────────┘  │
└───────────────────────┼──────────────────────────────┘
                        │ RPC
┌───────────────────────▼──────────────────────────────┐
│               Solana Devnet / Localnet                │
│  ┌────────────────────────────────────────────────┐  │
│  │         Anchor Program (konahrik)              │  │
│  │  ┌──────────┐ ┌─────────┐ ┌────────────────┐  │  │
│  │  │ AmmState │ │Position │ │UserMarginAccount│  │  │
│  │  │ (global) │ │(per pos)│ │  (per user)     │  │  │
│  │  └──────────┘ └─────────┘ └────────────────┘  │  │
│  │                                                │  │
│  │  Instructions:                                 │  │
│  │  open_position │ close_position │ liquidate    │  │
│  │  deposit_margin │ withdraw_margin              │  │
│  │  update_funding │ update_config                │  │
│  │  initialize_amm                                │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## vAMM Mechanics

### Constant Product Formula

The vAMM uses a constant-product curve:

```
k = base_asset_reserve × quote_asset_reserve
```

Where:
- `base_asset_reserve` — Virtual SOL reserves (lamports, 1e9 precision)
- `quote_asset_reserve` — Virtual USDC reserves (1e6 precision)
- `k` — Constant product invariant

When a position is opened or closed, the reserves adjust along the curve, preserving `k`.

### Mark Price

Derived from the vAMM reserves, adjusted for the decimal difference between SOL (1e9) and USDC (1e6):

```
mark_price (1e6)  = quote_reserve × 1_000_000_000 / base_reserve
mark_price (USD)  = mark_price(1e6) / 1_000_000
```

The frontend simplifies this to: `price = quote_reserve × 1000 / base_reserve`.

### Entry Price

Stored on-chain at 1e6 precision:

```
entry_price = notional × 1_000_000_000 / size
```

- `notional` — In USDC (1e6): `collateral × leverage`
- `size` — In SOL lamports (1e9): the amount of virtual SOL acquired from the vAMM
- Result — Price × 1_000_000 (e.g. $80.50 → 80,500,000)

The frontend divides by 1,000,000 for display.

### Funding Rate

Calculated each funding period (default 5 seconds on devnet):

```
funding_rate = (mark_price − index_price) × 1_000_000_000 / index_price / 24
```

- `mark_price` — vAMM price (1e6 scale)
- `index_price` — Pyth oracle price (1e6 scale)
- Result — Funding rate per period in 1e9 scale

Funding payment is applied to the position's **notional value** on close or liquidation:

```
funding_payment = position.notional × cumulative_rate_diff / 1_000_000_000
```

### Liquidation

A position is liquidatable when its margin ratio falls below the maintenance margin threshold:

```
margin_ratio = (margin + unrealized_pnl) × 10_000 / notional
```

If `margin_ratio < maint_margin_bps` (e.g. 625 bps = 6.25%), anyone can liquidate the position.

The frontend estimates the liquidation price:

```
liq_price = entry_price × (1 − 1/leverage + maint_margin_bps/10000)    // long
liq_price = entry_price × (1 + 1/leverage − maint_margin_bps/10000)    // short
```

### PnL

**Unrealized (frontend display):**

```
PnL = (mark_price − entry_price) × size_in_SOL   // long
PnL = (entry_price − mark_price) × size_in_SOL   // short
```

**Realized (on-chain at close/liquidation):**

```
realized_pnl = quote_received − position.notional   // long
realized_pnl = position.notional − quote_paid        // short
```

Where `quote_received`/`quote_paid` come from trading the position against the vAMM curve.

---

## Smart Contract

### Program ID (Devnet)

```
9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk
```

### Instructions

| Instruction | Description |
|---|---|
| `initialize_amm` | Create the global AmmState account with initial reserves, fees, and margins. Authority only. |
| `deposit_margin` | Deposit USDC into a user's margin account. |
| `withdraw_margin` | Withdraw USDC from a user's margin account. |
| `open_position` | Open a long or short position. Computes entry price from vAMM, locks margin. |
| `close_position` | Close a position, return margin + PnL − fees − funding. |
| `liquidate` | Liquidate an underwater position. Pays liquidation fee to liquidator. |
| `update_funding` | Calculate and accumulate funding rate based on mark vs index price premium. |
| `update_config` | Update AMM parameters (fees, margins, period, or reserves). Authority only. |

### State Accounts

**AmmState** (global singleton via PDA `amm_state`):

| Field | Type | Description |
|---|---|---|
| `authority` | `Pubkey` | Admin key for config updates |
| `base_asset_reserve` | `u128` | Virtual SOL reserves (lamports) |
| `quote_asset_reserve` | `u128` | Virtual USDC reserves (1e6) |
| `k` | `u128` | Constant product invariant |
| `cumulative_funding_rate` | `i128` | Accumulated funding rate |
| `initial_margin_bps` | `u16` | Initial margin requirement (bps) |
| `maint_margin_bps` | `u16` | Maintenance margin threshold (bps) |
| `trading_fee_bps` | `u16` | Trading fee (bps) |
| `liquidation_fee_bps` | `u16` | Liquidation fee (bps) |
| `funding_period` | `i64` | Seconds between funding updates |

**Position** (per position via PDA `position_<owner>_<id>`):

| Field | Type | Description |
|---|---|---|
| `owner` | `Pubkey` | Position owner |
| `position_id` | `u32` | Auto-incrementing ID |
| `is_long` | `bool` | Long or short |
| `size` | `u64` | Position size in SOL lamports |
| `notional` | `u64` | Notional value in USDC (1e6) |
| `entry_price` | `u64` | Entry price (1e6 scale) |
| `margin` | `u64` | Locked margin (USDC 1e6) |
| `funding_snapshot` | `i128` | Cached funding rate at open |

**UserMarginAccount** (per user via PDA `margin_<user>`):

| Field | Type | Description |
|---|---|---|
| `collateral` | `u64` | Total collateral deposited (USDC 1e6) |
| `free_collateral` | `u64` | Available for new positions |
| `next_position_id` | `u32` | Counter for new positions |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Solana (devnet / localnet) |
| Smart Contract | Anchor 1.0.1 (Rust) |
| Client SDK | @anchor-lang/core 1.0.1 |
| Frontend Framework | Next.js 16 |
| Language | TypeScript |
| Charting | lightweight-charts v5 |
| Styling | Tailwind CSS |
| Wallet | @solana/wallet-adapter-react |
| Oracle | Pyth (devnet: `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`) |

---

## Configuration Reference

All constants live in `app/src/lib/constants.ts`:

| Constant | Value | Description |
|---|---|---|
| `PROGRAM_ID` | `9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk` | Deployed program address |
| `DEVNET_RPC` | `https://api.devnet.solana.com` | Public Solana devnet endpoint |
| `LOCALNET_RPC` | `http://localhost:8899` | Local validator endpoint |
| `PYTH_SOL_USD_FEED` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Pyth SOL/USD oracle |
| `USDC_MINT` | Your devnet USDC mint | Created by `scripts/init.ts` |
| `INITIAL_BASE_RESERVE` | `1_000_000 × 1e9` | 1M virtual SOL |
| `INITIAL_QUOTE_RESERVE` | `80_000_000 × 1e6` | 80M virtual USDC |
| `SCALE_1E6` | `1_000_000` | USDC decimal scale |
| `SCALE_1E9` | `1_000_000_000` | SOL decimal scale |
| `POLLING_INTERVAL_MS` | `3000` | Frontend poll interval |

---

## Local Development

### Prerequisites

- Rust (latest stable)
- Solana CLI 3.1.10+
- Anchor CLI 1.0.1+
- Node.js 20+
- Yarn

### Localnet (Full Local Development)

Run everything on your machine with a local Solana validator.

**1. Clone and install dependencies:**

```bash
git clone https://github.com/ohmygodashish/konahrik.git
cd konahrik

# Install Anchor dependencies (yarn)
# Install frontend dependencies
cd app && npm install && cd ..
```

**2. Configure for localnet:**

In `Anchor.toml`, verify:
```toml
[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

In `app/src/lib/constants.ts`, temporarily switch:
```typescript
// Use localnet
export const DEVNET_RPC = "http://localhost:8899";
// Update USDC_MINT after running init.ts
// PROGRAM_ID stays the same for localnet (Anchor.toml already has it)
```

**3. Build the program:**

```bash
anchor build
```

**4. Start local validator with Pyth oracle fixture:**

```bash
solana-test-validator --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE --url devnet
```

Or use the Anchor test validator (includes the Pyth fixture automatically):

```bash
anchor test --skip-deploy
```

**5. Deploy and initialize:**

```bash
anchor deploy
npx ts-node scripts/init.ts
```

Copy the printed `USDC_MINT` address into `app/src/lib/constants.ts`.

**6. Update config (optional):**

```bash
npx ts-node scripts/update-config.ts --price 80 --funding-period 5
```

**7. Start the frontend:**

```bash
cd app && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Devnet (Test Against Live Network)

**1. Configure for devnet:**

In `Anchor.toml`:
```toml
[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
```

In `app/src/lib/constants.ts`, confirm:
```typescript
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const USDC_MINT = new PublicKey("<your-devnet-usdc-mint>");
```

**2. Build and deploy:**

```bash
anchor build
anchor program deploy --provider.cluster devnet
```

If the binary is larger than the on-chain ProgramData account, extend it first:
```bash
solana program show <PROGRAM_ID> --url devnet
# Compare dataLen with local target/deploy/konahrik.so
solana program extend <PROGRAM_ID> 25000 --url devnet
anchor program deploy --provider.cluster devnet
```

**3. Initialize (first deployment only):**

```bash
npx ts-node scripts/init.ts
```

**4. Update config:**

```bash
npx ts-node scripts/update-config.ts --price <current_sol_price> --funding-period 5 --initial-margin 1000 --maint-margin 625 --liquidation-fee 250 --trading-fee 10
```

**5. Copy regenerated IDL to frontend:**

```bash
cp target/idl/konahrik.json app/src/types/konahrik.json
```

**6. Start the frontend:**

```bash
cd app && npm run dev
```

Or deploy to Vercel (see below).

---

## Scripts

### `scripts/init.ts`

Creates a new USDC mint, initializes the AMM state with 1M virtual SOL and 80M virtual USDC, and creates the vault. Run once per program deployment.

```bash
npx ts-node scripts/init.ts
```

### `scripts/update-config.ts`

Update AMM configuration parameters on an already-initialized program. Can update fees, margins, funding period, and vAMM reserves.

```bash
# Set target mark price to $80
npx ts-node scripts/update-config.ts --price 80

# Update multiple params at once
npx ts-node scripts/update-config.ts --price 80 --trading-fee 10 --initial-margin 1000

# View current config without changes
npx ts-node scripts/update-config.ts --show
```

Options:

| Flag | Description |
|---|---|
| `--price <dollars>` | Set mark price (computes quote reserve from base) |
| `--base-reserve <value>` | Set base reserve directly (lamports) |
| `--quote-reserve <value>` | Set quote reserve directly (USDC 1e6) |
| `--funding-period <seconds>` | Funding period in seconds |
| `--initial-margin <bps>` | Initial margin requirement (1000 = 10%) |
| `--maint-margin <bps>` | Maintenance margin threshold (625 = 6.25%) |
| `--trading-fee <bps>` | Trading fee (10 = 0.1%) |
| `--liquidation-fee <bps>` | Liquidation fee (250 = 2.5%) |
| `--show` | Display current config |

### `scripts/faucet.ts`

Request devnet SOL and mint test USDC for a wallet.

```bash
npx ts-node scripts/faucet.ts <wallet_address>
```

---

## Deployment Guide

### Deploying the Program to Devnet

```bash
anchor build
anchor program deploy --provider.cluster devnet
```

### Deploying the Frontend to Vercel

1. Push the repository to GitHub (ensure `app/src/lib/constants.ts` has the correct devnet `USDC_MINT` and `PROGRAM_ID`).
2. On [vercel.com](https://vercel.com), import the repository.
3. Set the root directory to `app/`.
4. Framework is auto-detected as **Next.js**.
5. No environment variables are needed (all config is in `constants.ts`).
6. Deploy.

---

## Precision Notes

All on-chain prices use fixed-point arithmetic:

- **Entry / Mark / Index prices:** 1e6 scale (multiply by 1,000,000). E.g. `80.50 USD = 80,500,000`.
- **SOL amounts:** 1e9 scale (lamports). E.g. `1 SOL = 1,000,000,000`.
- **USDC amounts:** 1e6 scale. E.g. `1 USDC = 1,000,000`.
- **Funding rate:** 1e9 scale (unitless ratio).
- **Fees (bps):** Basis points, divided by 10,000: `fee = amount × bps / 10_000`.
- **Entry price formula:** `entry_price = notional × 1_000_000_000 / size` — the extra factor of 1e3 (beyond the naive 1e6/1e9 adjustment) is to maintain precision in the integer division.

---

## License

MIT
