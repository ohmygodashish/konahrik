"use client";

import { useEffect, useState } from "react";
import { useAnchor } from "@/providers/AnchorProvider";
import { getAmmStatePDA } from "@/lib/anchor-client";
import { POLLING_INTERVAL_MS } from "@/lib/constants";
import type { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";

export interface AmmStateData {
  authority: PublicKey;
  baseAssetReserve: BN;
  quoteAssetReserve: BN;
  k: BN;
  cumulativeFundingRate: BN;
  lastFundingTs: BN;
  openInterestLong: BN;
  openInterestShort: BN;
  usdcMint: PublicKey;
  vault: PublicKey;
  pythFeed: PublicKey;
  initialMarginBps: number;
  maintMarginBps: number;
  liquidationFeeBps: number;
  tradingFeeBps: number;
  fundingPeriod: BN;
  bump: number;
}

export function useAmmState() {
  const { program } = useAnchor();
  const [ammState, setAmmState] = useState<AmmStateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!program) {
      setLoading(false);
      return;
    }

    const fetchAmmState = async () => {
      try {
        const [ammStatePDA] = getAmmStatePDA();
        const data = await (program.account as any).ammState.fetch(ammStatePDA);
        setAmmState(data as unknown as AmmStateData);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch AmmState:", err);
        setError("Failed to fetch AMM state");
      } finally {
        setLoading(false);
      }
    };

    fetchAmmState();
    const interval = setInterval(fetchAmmState, POLLING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [program]);

  return { ammState, loading, error };
}
