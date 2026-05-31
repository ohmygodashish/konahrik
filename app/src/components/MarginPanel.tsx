"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { getMarginPDA, getAmmStatePDA, getVaultAuthorityPDA } from "@/lib/anchor-client";
import { submitTransaction } from "@/lib/tx-helpers";
import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

export function MarginPanel() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { program } = useAnchor();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    if (!program || !publicKey || !amount) return;

    setLoading(true);
    await submitTransaction(async () => {
      const value = new BN(Math.floor(parseFloat(amount) * 1_000_000));
      const [marginPDA] = getMarginPDA(publicKey);
      const [ammStatePDA] = getAmmStatePDA();

      const ammState = await (program.account as any).ammState.fetch(ammStatePDA);
      const vault = ammState.vault as PublicKey;

      const userUsdcAccount = await getOrCreateTokenAccount(
        connection,
        publicKey,
        ammState.usdcMint as PublicKey,
        sendTransaction
      );

      await program.methods
        .depositMargin(value)
        .accounts({
          user: publicKey,
          userMarginAccount: marginPDA,
          ammState: ammStatePDA,
          vault,
          userUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setAmount("");
    }, "Deposit");
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (!program || !publicKey || !amount) return;

    setLoading(true);
    await submitTransaction(async () => {
      const value = new BN(Math.floor(parseFloat(amount) * 1_000_000));
      const [marginPDA] = getMarginPDA(publicKey);
      const [ammStatePDA] = getAmmStatePDA();
      const [vaultAuthority] = getVaultAuthorityPDA();

      const ammState = await (program.account as any).ammState.fetch(ammStatePDA);
      const vault = ammState.vault as PublicKey;

      const userUsdcAccount = await getOrCreateTokenAccount(
        connection,
        publicKey,
        ammState.usdcMint as PublicKey,
        sendTransaction
      );

      await program.methods
        .withdrawMargin(value)
        .accounts({
          user: publicKey,
          userMarginAccount: marginPDA,
          userUsdcAccount,
          vault,
          vaultAuthority,
          ammState: ammStatePDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setAmount("");
    }, "Withdrawal");
    setLoading(false);
  };

  const handleAction = mode === "deposit" ? handleDeposit : handleWithdraw;
  const isDeposit = mode === "deposit";

  if (!publicKey) {
    return (
      <div className="terminal-panel p-4 mb-4">
        <h3 className="text-white font-semibold mb-2">Margin</h3>
        <p className="text-outline text-[13px]">Connect wallet to manage margin</p>
      </div>
    );
  }

  return (
    <div className="terminal-panel p-4 mb-4">
      <h3 className="text-white font-semibold mb-3">Margin</h3>

      <div className="flex items-center bg-surface-container-low rounded mb-3">
        <button
          onClick={() => { setMode("deposit"); setAmount(""); }}
          className={`flex-1 py-2 text-center text-[13px] font-medium rounded-l transition-colors cursor-pointer ${
            isDeposit
              ? "bg-positive text-white"
              : "text-outline hover:text-white"
          }`}
        >
          Deposit
        </button>
        <button
          onClick={() => { setMode("withdraw"); setAmount(""); }}
          className={`flex-1 py-2 text-center text-[13px] font-medium rounded-r transition-colors cursor-pointer ${
            !isDeposit
              ? "bg-surface-container-high text-white"
              : "text-outline hover:text-white"
          }`}
        >
          Withdraw
        </button>
      </div>

      <div className="flex items-center bg-surface-container-low rounded">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="flex-1 bg-transparent px-3 py-2 text-white font-mono-data text-[14px] focus:outline-none min-w-0"
        />
        <button
          onClick={handleAction}
          disabled={loading || !amount}
          className={`px-4 py-2 rounded-r text-white text-[14px] font-medium active:scale-[0.96] transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isDeposit
              ? "bg-positive hover:bg-positive/90"
              : "bg-surface-container-high hover:bg-surface-variant"
          }`}
        >
          {loading ? "..." : isDeposit ? "Deposit" : "Withdraw"}
        </button>
      </div>
    </div>
  );
}

async function getOrCreateTokenAccount(
  connection: any,
  owner: PublicKey,
  mint: PublicKey,
  sendTransaction: any
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const accountInfo = await connection.getAccountInfo(ata);

  if (!accountInfo) {
    const transaction = new (await import("@solana/web3.js")).Transaction().add(
      createAssociatedTokenAccountInstruction(owner, ata, owner, mint)
    );
    const signature = await sendTransaction(transaction, connection);
    await connection.confirmTransaction(signature, "confirmed");
  }

  return ata;
}
