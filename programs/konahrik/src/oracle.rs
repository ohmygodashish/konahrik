use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

use crate::errors::KonahrikError;

pub const SOL_USD_FEED_ID: &str =
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
pub const STALENESS_THRESHOLD_SECS: u64 = 60;

pub fn get_index_price(price_update: &Account<'_, PriceUpdateV2>) -> Result<u64> {
    let feed_id =
        get_feed_id_from_hex(SOL_USD_FEED_ID).map_err(|_| error!(KonahrikError::OracleStaleness))?;

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
