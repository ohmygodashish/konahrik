"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { useAmmState } from "@/hooks/useAmmState";
import {
  getMarginPDA,
  getAmmStatePDA,
  getPositionPDA,
} from "@/lib/anchor-client";
import { submitTransaction } from "@/lib/tx-helpers";
import { getMarkPrice, getUnrealizedPnl, scaleToNumber } from "@/lib/math";
import { SCALE_1E6, SCALE_1E9, PYTH_SOL_USD_FEED } from "@/lib/constants";
import { PublicKey } from "@solana/web3.js";

interface Position {
  publicKey: PublicKey;
  positionId: number;
  isLong: boolean;
  size: number;
  notional: number;
  entryPrice: number;
  margin: number;
}

export function PositionsTab() {
  const { publicKey } = useWallet();
  const { program } = useAnchor();
  const { ammState } = useAmmState();
  const [positions, setPositions] = useState<Position[]>([]);
  const [closingId, setClosingId] = useState<number | null>(null);

  useEffect(() => {
    if (!program || !publicKey) return;

    const fetchPositions = async () => {
      try {
        const [marginPDA] = getMarginPDA(publicKey);
        const margin = await (program.account as any).userMarginAccount.fetch(
          marginPDA
        );
        const nextPositionId = margin.nextPositionId;

        const fetchedPositions: Position[] = [];
        for (let i = 0; i < nextPositionId; i++) {
          try {
            const [positionPDA] = getPositionPDA(publicKey, i);
            const pos = await (program.account as any).position.fetch(
              positionPDA
            );
            fetchedPositions.push({
              publicKey: positionPDA,
              positionId: i,
              isLong: pos.isLong,
              size: pos.size.toNumber() / 1_000_000_000,
              notional: pos.notional.toNumber() / 1_000_000,
              entryPrice: pos.entryPrice.toNumber() / 1_000_000,
              margin: pos.margin.toNumber() / 1_000_000,
            });
          } catch (err) {}
        }
        setPositions(fetchedPositions);
      } catch (err) {
        setPositions([]);
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [program, publicKey]);

  const handleClosePosition = async (positionId: number) => {
    if (!program || !publicKey) return;

    setClosingId(positionId);
    await submitTransaction(async () => {
      const [marginPDA] = getMarginPDA(publicKey);
      const [ammStatePDA] = getAmmStatePDA();
      const [positionPDA] = getPositionPDA(publicKey, positionId);

      await program.methods
        .closePosition()
        .accounts({
          user: publicKey,
          userMarginAccount: marginPDA,
          position: positionPDA,
          ammState: ammStatePDA,
          pythPriceFeed: PYTH_SOL_USD_FEED,
        })
        .rpc();
    }, "Close Position");
    setClosingId(null);
  };

  if (!publicKey) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        Connect wallet to view positions
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        No open positions. Open your first position to get started.
      </div>
    );
  }

  const markPrice = ammState
    ? getMarkPrice(
        BigInt(ammState.baseAssetReserve.toString()),
        BigInt(ammState.quoteAssetReserve.toString())
      )
    : 0;

  return (
    <div className="p-4 space-y-3">
      {positions.map((pos) => {
        const pnl = getUnrealizedPnl(pos.isLong, pos.entryPrice, markPrice, pos.size);
        const pnlPercent = (pnl / pos.margin) * 100;

        return (
          <div
            key={pos.positionId}
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
              <button
                onClick={() => handleClosePosition(pos.positionId)}
                disabled={closingId === pos.positionId}
                className="bg-surface-container-high text-white px-3 py-1 rounded text-[12px] hover:bg-surface-variant active:scale-[0.96] transition-transform disabled:opacity-50"
              >
                {closingId === pos.positionId ? "Closing..." : "Close"}
              </button>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-outline text-[11px] mb-0.5">
                  Unrealized PnL
                </div>
                <div
                  className={`font-mono-data text-[14px] font-semibold ${
                    pnl >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPercent.toFixed(2)}
                  %)
                </div>
              </div>
              <div className="text-right">
                <div className="text-outline text-[11px]">Mark Price</div>
                <div className="text-white font-mono-data text-[13px]">
                  ${markPrice.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
