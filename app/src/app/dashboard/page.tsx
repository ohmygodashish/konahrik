"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { useAmmState } from "@/hooks/useAmmState";
import {
  getMarginPDA,
  getAmmStatePDA,
  getPositionPDA,
} from "@/lib/anchor-client";
import { getMarkPrice, getUnrealizedPnl } from "@/lib/math";
import { PYTH_SOL_USD_FEED } from "@/lib/constants";
import { PublicKey } from "@solana/web3.js";

interface Position {
  positionId: number;
  isLong: boolean;
  size: number;
  notional: number;
  entryPrice: number;
  margin: number;
}

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { program } = useAnchor();
  const { ammState } = useAmmState();

  const [collateral, setCollateral] = useState(0);
  const [freeCollateral, setFreeCollateral] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);

  const markPrice = ammState
    ? getMarkPrice(
        BigInt(ammState.baseAssetReserve.toString()),
        BigInt(ammState.quoteAssetReserve.toString())
      )
    : 0;

  useEffect(() => {
    if (!program || !publicKey) return;

    const fetchData = async () => {
      try {
        const [marginPDA] = getMarginPDA(publicKey);
        const margin = await (program.account as any).userMarginAccount.fetch(
          marginPDA
        );
        setCollateral(margin.collateral.toNumber() / 1_000_000);
        setFreeCollateral(margin.freeCollateral.toNumber() / 1_000_000);

        const nextPositionId = margin.nextPositionId;
        const fetched: Position[] = [];
        for (let i = 0; i < nextPositionId; i++) {
          try {
            const [positionPDA] = getPositionPDA(publicKey, i);
            const pos = await (program.account as any).position.fetch(
              positionPDA
            );
            fetched.push({
              positionId: i,
              isLong: pos.isLong,
              size: pos.size.toNumber() / 1_000_000_000,
              notional: pos.notional.toNumber() / 1_000_000,
              entryPrice: pos.entryPrice.toNumber() / 1_000_000,
              margin: pos.margin.toNumber() / 1_000_000,
            });
          } catch {}
        }
        setPositions(fetched);
      } catch {
        setCollateral(0);
        setFreeCollateral(0);
        setPositions([]);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [program, publicKey]);

  const totalUnrealizedPnl = positions.reduce((sum, pos) => {
    return sum + getUnrealizedPnl(pos.isLong, pos.entryPrice, markPrice, pos.size);
  }, 0);

  const totalValue = collateral + totalUnrealizedPnl;
  const utilization =
    collateral > 0
      ? Math.round(((collateral - freeCollateral) / collateral) * 100)
      : 0;

  if (!publicKey) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-white text-lg font-semibold mb-2">
            Connect Wallet
          </h2>
          <p className="text-outline text-[14px]">
            Connect your wallet to view the dashboard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[1280px] mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div>
            <h1 className="font-display-md text-[36px] leading-[44px] font-semibold text-on-surface tracking-tight">
              Welcome Back{" "}
              {publicKey && (
                <span className="text-electric-indigo">{publicKey.toBase58()}</span>
              )}
            </h1>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Account Overview */}
          <div className="md:col-span-8 terminal-panel p-6 md:p-8">
            <h2 className="text-headline-lg font-semibold text-on-surface mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-electric-indigo text-[24px]">
                account_balance_wallet
              </span>
              Account Overview
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Total Value
                </span>
                <span className="font-display-md text-[36px] leading-[44px] font-semibold text-on-surface font-mono-data">
                  ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {totalUnrealizedPnl !== 0 && (
                  <div
                    className={`flex items-center gap-1 mt-1 w-fit px-2 py-0.5 rounded text-xs font-mono-data font-semibold ${
                      totalUnrealizedPnl >= 0
                        ? "text-cyan-pulse bg-cyan-pulse/10"
                        : "text-crimson-fury bg-crimson-fury/10"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {totalUnrealizedPnl >= 0 ? "trending_up" : "trending_down"}
                    </span>
                    {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 sm:pl-6 sm:border-l border-surface-container-high">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Unrealized PnL
                </span>
                <span
                  className={`font-headline-lg text-[24px] leading-[32px] font-semibold font-mono-data ${
                    totalUnrealizedPnl >= 0 ? "text-cyan-pulse" : "text-crimson-fury"
                  }`}
                >
                  {totalUnrealizedPnl >= 0 ? "+" : ""}${totalUnrealizedPnl.toFixed(2)}
                </span>
              </div>
              <div className="flex flex-col gap-1 sm:pl-6 sm:border-l border-surface-container-high">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Free Collateral
                </span>
                <span className="font-headline-lg text-[24px] leading-[32px] font-semibold text-on-surface font-mono-data">
                  ${freeCollateral.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Margin Risk Gauge */}
          <div className="md:col-span-4 terminal-panel p-6 flex flex-col items-center justify-center relative">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant absolute top-6 left-6">
              Margin Risk
            </h3>
            <div className="relative w-40 h-40 mt-4 flex items-center justify-center">
              <svg
                className="w-full h-full -rotate-90 transform"
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  fill="none"
                  r="45"
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="8"
                />
                <circle
                  cx="50"
                  cy="50"
                  fill="none"
                  r="45"
                  stroke="#6366F1"
                  strokeLinecap="round"
                  strokeWidth="8"
                  strokeDasharray="283"
                  strokeDashoffset={283 - (283 * utilization) / 100}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="font-display-md text-[36px] leading-[44px] font-semibold text-electric-indigo font-mono-data">
                  {utilization}%
                </span>
                <span className="text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant mt-1">
                  Utilization
                </span>
              </div>
            </div>
            <div className="w-full mt-6 flex justify-between font-mono-data text-[13px] text-on-surface-variant">
              <span>Safe</span>
              <span className="text-crimson-fury">Liquidation</span>
            </div>
          </div>

          {/* Active Positions Table */}
          <div className="md:col-span-12 terminal-panel overflow-hidden flex flex-col">
            <div className="p-6 border-b border-surface-container flex justify-between items-center">
              <h3 className="text-headline-lg font-semibold text-on-surface">
                Active Positions
              </h3>
              <Link
                href="/"
                className="text-electric-indigo text-[12px] font-semibold uppercase tracking-wider hover:text-primary transition-colors flex items-center gap-1"
              >
                View All
                <span className="material-symbols-outlined text-[16px]">
                  arrow_forward
                </span>
              </Link>
            </div>

            {positions.length === 0 ? (
              <div className="p-8 text-center text-outline text-[13px]">
                No active positions
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-dim/50 border-b border-surface-container">
                      <th className="p-4 text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                        Market
                      </th>
                      <th className="p-4 text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                        Size
                      </th>
                      <th className="p-4 text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                        Entry Price
                      </th>
                      <th className="p-4 text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
                        Mark Price
                      </th>
                      <th className="p-4 text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant text-right">
                        Unrealized PnL
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-data text-[13px]">
                    {positions.map((pos) => {
                      const pnl = getUnrealizedPnl(
                        pos.isLong,
                        pos.entryPrice,
                        markPrice,
                        pos.size
                      );
                      return (
                        <tr
                          key={pos.positionId}
                          className="border-b border-surface-container hover:bg-surface-container-high/30 transition-colors"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-electric-indigo font-bold text-[12px]">
                                S
                              </div>
                              <div>
                                <div className="text-on-surface font-semibold text-[14px]">
                                  SOL-PERP
                                </div>
                                <div
                                  className={`text-[11px] px-1.5 py-0.5 rounded w-fit mt-0.5 ${
                                    pos.isLong
                                      ? "text-cyan-pulse bg-cyan-pulse/10"
                                      : "text-crimson-fury bg-crimson-fury/10"
                                  }`}
                                >
                                  {pos.notional > 0
                                    ? `${Math.round(pos.notional / pos.margin)}x`
                                    : "—"}{" "}
                                  {pos.isLong ? "Long" : "Short"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-on-surface">
                            {pos.size.toFixed(4)} SOL
                          </td>
                          <td className="p-4 text-on-surface-variant">
                            ${pos.entryPrice.toFixed(2)}
                          </td>
                          <td className="p-4 text-on-surface">
                            ${markPrice.toFixed(2)}
                          </td>
                          <td
                            className={`p-4 text-right ${
                              pnl >= 0 ? "text-cyan-pulse" : "text-crimson-fury"
                            }`}
                          >
                            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
