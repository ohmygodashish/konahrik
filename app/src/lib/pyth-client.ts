import { PublicKey } from "@solana/web3.js";
import { PYTH_SOL_USD_FEED } from "./constants";

const PYTH_HERMES_BASE_URL = "https://hermes.pyth.network";

export interface PythPriceData {
  price: number;
  conf: number;
  exponent: number;
  publishTime: number;
}

export async function getPythPrice(feedId: PublicKey = PYTH_SOL_USD_FEED): Promise<PythPriceData | null> {
  try {
    const feedIdHex = "0x" + feedId.toBuffer().toString("hex");
    const response = await fetch(
      `${PYTH_HERMES_BASE_URL}/api/latest_price_feeds?ids[]=${feedIdHex}`
    );

    if (!response.ok) {
      throw new Error(`Pyth API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return null;
    }

    const priceFeed = data[0];
    const price = priceFeed.price;

    return {
      price: Number(price.price) * Math.pow(10, price.expo),
      conf: Number(price.conf) * Math.pow(10, price.expo),
      exponent: price.expo,
      publishTime: Number(price.publish_time),
    };
  } catch (error) {
    console.error("Failed to fetch Pyth price:", error);
    return null;
  }
}

export function formatPythPrice(priceData: PythPriceData | null): string {
  if (!priceData) return "---";
  return priceData.price.toFixed(2);
}
