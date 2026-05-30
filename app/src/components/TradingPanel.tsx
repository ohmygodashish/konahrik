"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { useAmmState } from "@/hooks/useAmmState";
import {
  getMarginPDA,
  getAmmStatePDA,
  getPositionPDA,
} from "@/lib/anchor-client";
import { getLiquidationPrice, getMarkPrice } from "@/lib/math";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { PYTH_SOL_USD_FEED } from "@/lib/constants";

export function TradingPanel() {
  const { publicKey } = useWallet();
  const { program } = useAnchor();
  const { ammState } = useAmmState();

  const [isLong, setIsLong] = useState(true);
  const [marginAmount, setMarginAmount] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [userMargin, setUserMargin] = useState<{
    collateral: number;
    freeCollateral: number;
    nextPositionId: number;
  } | null>(null);

  useEffect(() => {
    if (!program || !publicKey) return;

    const fetchMargin = async () => {
      try {
        const [marginPDA] = getMarginPDA(publicKey);
        const margin = await (program.account as any).userMarginAccount.fetch(
          marginPDA
        );
        setUserMargin({
          collateral: margin.collateral.toNumber() / 1_000_000,
          freeCollateral: margin.freeCollateral.toNumber() / 1_000_000,
          nextPositionId: margin.nextPositionId,
        });
      } catch (err) {
        setUserMargin(null);
      }
    };

    fetchMargin();
    const interval = setInterval(fetchMargin, 3000);
    return () => clearInterval(interval);
  }, [program, publicKey]);

  const markPrice = ammState
    ? getMarkPrice(
        BigInt(ammState.baseAssetReserve.toString()),
        BigInt(ammState.quoteAssetReserve.toString())
      )
    : 0;

  const marginNum = parseFloat(marginAmount) || 0;
  const notional = marginNum * leverage;
  const entryPrice = markPrice;

  const liqPrice =
    marginNum > 0 && ammState
      ? getLiquidationPrice(
          entryPrice,
          isLong,
          ammState.initialMarginBps,
          ammState.maintMarginBps
        )
      : 0;

  const handleOpenPosition = async () => {
    if (!program || !publicKey || !marginAmount || !ammState) return;

    setLoading(true);
    setMessage(null);

    try {
      const collateralAmount = new BN(
        Math.floor(parseFloat(marginAmount) * 1_000_000)
      );
      const [marginPDA] = getMarginPDA(publicKey);
      const [ammStatePDA] = getAmmStatePDA();

      const margin = await (program.account as any).userMarginAccount.fetch(
        marginPDA
      );
      const nextPositionId = margin.nextPositionId;

      const [positionPDA] = getPositionPDA(publicKey, nextPositionId);

      await program.methods
        .openPosition({
          isLong,
          collateralAmount,
          leverage,
          minBaseAmount: new BN(0),
        })
        .accounts({
          user: publicKey,
          userMarginAccount: marginPDA,
          position: positionPDA,
          ammState: ammStatePDA,
          pythPriceFeed: PYTH_SOL_USD_FEED,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setMessage({ type: "success", text: "Position opened!" });
      setMarginAmount("");
    } catch (err) {
      console.error("Open position failed:", err);
      setMessage({ type: "error", text: "Failed to open position" });
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="terminal-panel p-4">
        <h3 className="text-white font-semibold mb-2">Trade</h3>
        <p className="text-outline text-[13px]">Connect wallet to trade</p>
      </div>
    );
  }

  return (
    <div className="terminal-panel p-4">
      <h3 className="text-white font-semibold mb-4">Trade</h3>

      {/* Long/Short Toggle */}
      <div className="flex p-1 bg-surface-container-low rounded-lg mb-4">
        <button
          onClick={() => setIsLong(true)}
          className={`flex-1 py-2 text-center text-[14px] font-medium rounded-md transition-colors ${
            isLong
              ? "bg-positive text-white"
              : "text-outline hover:text-white"
          }`}
        >
          Long
        </button>
        <button
          onClick={() => setIsLong(false)}
          className={`flex-1 py-2 text-center text-[14px] font-medium rounded-md transition-colors ${
            !isLong
              ? "bg-negative text-white"
              : "text-outline hover:text-white"
          }`}
        >
          Short
        </button>
      </div>

      {/* Available Balance */}
      <div className="flex justify-between text-[12px] text-outline mb-4">
        <span>Available</span>
        <span>
          {userMargin ? `$${userMargin.freeCollateral.toFixed(2)}` : "---"}
        </span>
      </div>

      {/* Margin Input */}
      <div className="mb-4">
        <label className="text-outline text-[12px] mb-1 block">
          Margin (USDC)
        </label>
        <input
          type="number"
          value={marginAmount}
          onChange={(e) => setMarginAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-surface-container-low border border-surface-container-high rounded px-3 py-2 text-white font-mono-data text-[14px] focus:outline-none focus:border-outline"
        />
      </div>

      {/* Leverage Slider */}
      <div className="mb-6">
        <div className="flex justify-between text-[12px] mb-2">
          <span className="text-outline">Leverage</span>
          <span className="text-white font-mono-data font-semibold">
            {leverage}x
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-[11px] text-outline font-mono-data mt-1">
          <span>1x</span>
          <span>10x</span>
        </div>
      </div>

      {/* Position Preview */}
      <div className="mb-6 space-y-2">
        <div className="flex justify-between text-[12px]">
          <span className="text-outline">Notional</span>
          <span className="text-white font-mono-data">
            ${notional.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-outline">Entry Price</span>
          <span className="text-white font-mono-data">
            ${entryPrice.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-[12px]">
          <span className="text-outline">Liq. Price</span>
          <span className="text-negative font-mono-data">
            {liqPrice > 0 ? `$${liqPrice.toFixed(2)}` : "---"}
          </span>
        </div>
      </div>

      {/* Open Position Button */}
      <button
        onClick={handleOpenPosition}
        disabled={loading || !marginAmount || marginNum <= 0}
        className={`w-full py-3 rounded font-medium text-[15px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isLong
            ? "bg-positive text-white hover:bg-positive/90"
            : "bg-negative text-white hover:bg-negative/90"
        }`}
      >
        {loading ? "Opening..." : `Open ${isLong ? "Long" : "Short"}`}
      </button>

      {/* Message */}
      {message && (
        <div
          className={`text-[12px] p-2 rounded mt-3 ${
            message.type === "success"
              ? "bg-positive/10 text-positive"
              : "bg-negative/10 text-negative"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
