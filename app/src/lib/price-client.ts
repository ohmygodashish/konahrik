import { BINANCE_API_URL } from "./constants";

export interface PriceData {
  price: number;
  timestamp: number;
}

export async function getIndexPrice(): Promise<PriceData | null> {
  try {
    const response = await fetch(
      `${BINANCE_API_URL}?symbol=SOLUSDT`
    );

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
