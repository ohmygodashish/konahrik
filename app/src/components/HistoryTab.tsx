"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getClosedPositions, type ClosedPosition } from "@/lib/history";

export function HistoryTab() {
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<ClosedPosition[]>([]);

  useEffect(() => {
    if (!publicKey) return;

    const load = () => {
      setPositions(getClosedPositions(publicKey.toBase58()));
    };

    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        Connect wallet to view history
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        No closed positions yet.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {positions.map((pos) => (
        <div
          key={`${pos.positionId}-${pos.closedAt}`}
          className="border border-surface-container-high rounded p-3 shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
        >
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[12px] font-semibold px-2 py-0.5 rounded ${
                    pos.isLong
                      ? "bg-positive/20 text-positive"
                      : "bg-negative/20 text-negative"
                  }`}
                >
                  {pos.isLong ? "LONG" : "SHORT"}
                </span>
                <span className="text-white text-[13px] font-medium font-mono-data">
                  {pos.size.toFixed(4)} SOL
                </span>
              </div>
              <div className="text-outline text-[11px]">
                Entry: <span className="font-mono-data">${pos.entryPrice.toFixed(2)}</span> | Margin: <span className="font-mono-data">${pos.margin.toFixed(2)}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-outline text-[11px] block">
                {new Date(pos.closedAt).toLocaleDateString()} {new Date(pos.closedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
