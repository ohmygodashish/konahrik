"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { getMarginPDA } from "@/lib/anchor-client";

export function BalancesTab() {
  const { publicKey } = useWallet();
  const { program } = useAnchor();
  const [margin, setMargin] = useState<{
    collateral: number;
    freeCollateral: number;
    lockedMargin: number;
  } | null>(null);

  useEffect(() => {
    if (!program || !publicKey) return;

    const fetchMargin = async () => {
      try {
        const [marginPDA] = getMarginPDA(publicKey);
        const data = await (program.account as any).userMarginAccount.fetch(
          marginPDA
        );
        const collateral = data.collateral.toNumber() / 1_000_000;
        const freeCollateral = data.freeCollateral.toNumber() / 1_000_000;
        setMargin({
          collateral,
          freeCollateral,
          lockedMargin: collateral - freeCollateral,
        });
      } catch (err) {
        setMargin(null);
      }
    };

    fetchMargin();
    const interval = setInterval(fetchMargin, 3000);
    return () => clearInterval(interval);
  }, [program, publicKey]);

  if (!publicKey) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        Connect wallet to view balances
      </div>
    );
  }

  if (!margin) {
    return (
      <div className="p-4 text-center text-outline text-[13px]">
        Deposit USDC to start trading.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between text-[13px]">
        <span className="text-outline">Total Collateral</span>
        <span className="text-white font-mono-data">
          ${margin.collateral.toFixed(2)}
        </span>
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="text-outline">Free Collateral</span>
        <span className="text-positive font-mono-data">
          ${margin.freeCollateral.toFixed(2)}
        </span>
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="text-outline">Locked in Positions</span>
        <span className="text-negative font-mono-data">
          ${margin.lockedMargin.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
