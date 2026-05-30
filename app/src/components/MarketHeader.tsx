"use client";

import { useAmmState } from "@/hooks/useAmmState";
import { getMarkPrice, scaleToNumber } from "@/lib/math";
import { SCALE_1E6, SCALE_1E9 } from "@/lib/constants";

export function MarketHeader() {
  const { ammState, loading } = useAmmState();

  const markPrice = ammState
    ? getMarkPrice(
        BigInt(ammState.baseAssetReserve.toString()),
        BigInt(ammState.quoteAssetReserve.toString())
      )
    : 0;

  const openInterestLong = ammState
    ? scaleToNumber(BigInt(ammState.openInterestLong.toString()), SCALE_1E6)
    : 0;

  const openInterestShort = ammState
    ? scaleToNumber(BigInt(ammState.openInterestShort.toString()), SCALE_1E6)
    : 0;

  const totalOI = openInterestLong + openInterestShort;

  return (
    <div className="h-14 bg-surface-container-lowest border-b border-surface-container flex items-center px-4 shrink-0 gap-6 overflow-x-auto hide-scrollbar">
      {/* Pair Info */}
      <div className="flex items-center gap-3 pr-4 border-r border-surface-container">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-void-surface border border-surface-container-high">
          <svg
            width="14"
            height="14"
            viewBox="0 0 397 311"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"
              fill="url(#solana-gradient-a)"
            />
            <path
              d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"
              fill="url(#solana-gradient-b)"
            />
            <path
              d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"
              fill="url(#solana-gradient-c)"
            />
            <defs>
              <linearGradient
                id="solana-gradient-a"
                x1="0"
                y1="0"
                x2="397"
                y2="311"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
              <linearGradient
                id="solana-gradient-b"
                x1="0"
                y1="0"
                x2="397"
                y2="311"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
              <linearGradient
                id="solana-gradient-c"
                x1="0"
                y1="0"
                x2="397"
                y2="311"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#00FFA3" />
                <stop offset="1" stopColor="#DC1FFF" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h1 className="text-[16px] font-bold flex items-center gap-2">
          SOL/USD
          <span className="text-electric-indigo text-[12px] bg-electric-indigo/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            10x
          </span>
        </h1>
      </div>

      {/* Mark Price */}
      <div className="text-[18px] font-mono-data text-white font-semibold">
        {loading ? "---" : markPrice.toFixed(2)}
      </div>

      {/* Stats */}
      <div className="flex gap-6">
        <div className="flex flex-col justify-center">
          <span className="text-outline text-[11px] uppercase">
            Open Interest
          </span>
          <span className="text-white font-mono-data text-[13px]">
            ${totalOI.toFixed(2)}
          </span>
        </div>

        <div className="flex flex-col justify-center">
          <span className="text-outline text-[11px] uppercase">OI Long</span>
          <span className="text-positive font-mono-data text-[13px]">
            ${openInterestLong.toFixed(2)}
          </span>
        </div>

        <div className="flex flex-col justify-center">
          <span className="text-outline text-[11px] uppercase">OI Short</span>
          <span className="text-negative font-mono-data text-[13px]">
            ${openInterestShort.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
