import { SCALE_1E6, SCALE_1E9 } from "./constants";

export function getMarkPrice(baseReserve: bigint, quoteReserve: bigint): number {
  if (baseReserve === 0n) return 0;
  return Number((quoteReserve * SCALE_1E6) / baseReserve) / 1_000_000;
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
  sizeInSOL: number
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
  if (notionalUsdc === 0) return 0;
  return (marginUsdc + unrealizedPnl) / notionalUsdc;
}

export function formatUsdc(amount: number, decimals: number = 2): string {
  return amount.toFixed(decimals);
}

export function formatSol(amount: number, decimals: number = 4): string {
  return amount.toFixed(decimals);
}

export function formatPercent(value: number, decimals: number = 2): string {
  return (value * 100).toFixed(decimals) + "%";
}

export function scaleToNumber(value: bigint, scale: bigint): number {
  return Number(value) / Number(scale);
}

export function numberToScale(value: number, scale: bigint): bigint {
  return BigInt(Math.floor(value * Number(scale)));
}
