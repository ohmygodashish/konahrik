"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@anchor-lang/core";
import { Connection } from "@solana/web3.js";
import { DEVNET_RPC, PROGRAM_ID } from "@/lib/constants";
import IDL_JSON from "@/types/konahrik.json";

type AnchorContextType = {
  program: Program | null;
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

    const connection = new Connection(DEVNET_RPC, "confirmed");
    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
    const program = new Program(IDL_JSON as any, provider);

    return { program, provider };
  }, [wallet]);

  return (
    <AnchorContext.Provider value={value}>{children}</AnchorContext.Provider>
  );
}
