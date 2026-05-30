"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import type { Konahrik } from "@/types/konahrik";
import IDL_JSON from "@/types/konahrik.json";
import { LOCALNET_RPC, PROGRAM_ID } from "@/lib/constants";

const IDL = IDL_JSON as unknown as Konahrik;

type AnchorContextType = {
  program: Program<Konahrik> | null;
  provider: AnchorProvider | null;
};

const AnchorContext = createContext<AnchorContextType>({
  program: null,
  provider: null,
});

export const useAnchor = () => useContext(AnchorContext);

export function AnchorProviderWrapper({ children }: { children: ReactNode }) {
  const wallet = useWallet();

  const value = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return { program: null, provider: null };
    }

    const connection = new Connection(LOCALNET_RPC, "confirmed");
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    const program = new Program(IDL, provider);

    return { program, provider };
  }, [wallet]);

  return (
    <AnchorContext.Provider value={value}>{children}</AnchorContext.Provider>
  );
}
