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
    <button
      onClick={disconnect}
      className="group relative border border-surface-variant px-4 py-1.5 rounded transition-colors text-[14px] font-medium font-mono-data cursor-pointer overflow-hidden text-center whitespace-nowrap w-[128px]"
    >
      <span className="relative z-10 text-white group-hover:text-white">
        <span className="group-hover:hidden">
          {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
        </span>
        <span className="hidden group-hover:inline">
          Disconnect
        </span>
      </span>
      <div className="absolute inset-0 bg-negative opacity-0 group-hover:opacity-100 transition-opacity rounded" />
    </button>
  );
}
