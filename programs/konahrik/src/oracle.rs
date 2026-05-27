use anchor_lang::prelude::*;

use crate::errors::KonahrikError;

pub const STALENESS_THRESHOLD_SECS: i64 = 60;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PriceFeedMessage {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub prev_publish_time: i64,
    pub ema_price: i64,
    pub ema_conf: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum VerificationLevel {
    Partial { num_signatures: u8 },
    Full,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PriceUpdateV2 {
    pub write_authority: Pubkey,
    pub verification_level: VerificationLevel,
    pub price_message: PriceFeedMessage,
    pub posted_slot: u64,
}

pub fn get_index_price(price_feed_info: &AccountInfo) -> Result<u64> {
    let data = price_feed_info.try_borrow_data()?;
    
    let mut data_slice: &[u8] = &data[8..];
    let price_update = PriceUpdateV2::deserialize(&mut data_slice)
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;

    let current_time = Clock::get()?.unix_timestamp;
    let publish_time = price_update.price_message.publish_time;

    require!(
        current_time - publish_time <= STALENESS_THRESHOLD_SECS,
        KonahrikError::OracleStaleness
    );

    let price = price_update.price_message.price;
    let conf = price_update.price_message.conf;
    let exponent = price_update.price_message.exponent;

    require!(
        conf < price.unsigned_abs() / 100,
        KonahrikError::OracleConfidence
    );

    let price_u64 = pyth_price_to_u64(price, exponent)?;
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
