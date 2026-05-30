"use client";

import { useAmmState } from "@/hooks/useAmmState";
import { getMarkPrice, scaleToNumber } from "@/lib/math";
import { SCALE_1E6 } from "@/lib/constants";

export function ProtocolStatsFooter() {
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
    <footer className="h-8 bg-surface-container-lowest border-t border-surface-container flex items-center px-4 shrink-0 text-[12px]">
      <div className="flex items-center gap-6">
        <div className="flex gap-2">
          <span className="text-outline">Mark Price</span>
          <span className="text-white font-mono-data">
            {loading ? "---" : `$${markPrice.toFixed(2)}`}
          </span>
        </div>

        <div className="flex gap-2">
          <span className="text-outline">Total OI</span>
          <span className="text-white font-mono-data">
            ${totalOI.toFixed(2)}
          </span>
        </div>

        <div className="flex gap-2">
          <span className="text-outline">Funding Rate</span>
          <span className="text-white font-mono-data">0.00%</span>
        </div>

        <div className="flex gap-2">
          <span className="text-outline">Trading Fee</span>
          <span className="text-white font-mono-data">
            {ammState ? `${ammState.tradingFeeBps / 100}%` : "---"}
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="text-outline">Network</span>
        <span className="text-positive font-mono-data">Localnet</span>
      </div>
    </footer>
  );
}
