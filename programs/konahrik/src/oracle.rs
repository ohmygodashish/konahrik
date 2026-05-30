use anchor_lang::prelude::*;

use crate::errors::KonahrikError;

const FALLBACK_INDEX_PRICE: u64 = 140_000_000;

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
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;
    Ok(i64::from_le_bytes(array))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 8] = bytes
        .try_into()
        .map_err(|_| error!(KonahrikError::OracleStaleness))?;
    Ok(u64::from_le_bytes(array))
}

fn read_i32(data: &[u8], offset: usize) -> Result<i32> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or(error!(KonahrikError::OracleStaleness))?;
    let array: [u8; 4] = bytes
        .try_into()
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
