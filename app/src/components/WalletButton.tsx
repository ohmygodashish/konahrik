"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function WalletButton() {
  const { publicKey, disconnect, connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (!connected) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="bg-white text-black px-4 py-1.5 rounded hover:bg-gray-200 transition-colors text-[14px] font-medium"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={disconnect}
        className="bg-transparent border border-surface-variant text-white px-4 py-1.5 rounded hover:bg-surface-container transition-colors text-[14px] font-medium font-mono-data"
      >
        {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
      </button>
    </div>
  );
}
