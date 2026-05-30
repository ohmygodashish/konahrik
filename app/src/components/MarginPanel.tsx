"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAnchor } from "@/providers/AnchorProvider";
import { getMarginPDA, getAmmStatePDA, getVaultAuthorityPDA } from "@/lib/anchor-client";
import { submitTransaction } from "@/lib/tx-helpers";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

export function MarginPanel() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { program } = useAnchor();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    if (!program || !publicKey || !depositAmount) return;

    setLoading(true);
    await submitTransaction(async () => {
      const amount = new BN(Math.floor(parseFloat(depositAmount) * 1_000_000));
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
        .depositMargin(amount)
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

      setDepositAmount("");
    }, "Deposit");
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (!program || !publicKey || !withdrawAmount) return;

    setLoading(true);
    await submitTransaction(async () => {
      const amount = new BN(Math.floor(parseFloat(withdrawAmount) * 1_000_000));
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
        .withdrawMargin(amount)
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

      setWithdrawAmount("");
    }, "Withdrawal");
    setLoading(false);
  };

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
      <h3 className="text-white font-semibold mb-4">Margin</h3>

      <div className="mb-4">
        <label className="text-outline text-[12px] mb-1 block">Deposit USDC</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-surface-container-low border border-surface-container-high rounded px-3 py-2 text-white font-mono-data text-[14px] focus:outline-none focus:border-outline"
          />
          <button
            onClick={handleDeposit}
            disabled={loading || !depositAmount}
            className="bg-positive text-white px-4 py-2 rounded hover:bg-positive/90 active:scale-[0.96] transition-transform disabled:opacity-50 disabled:cursor-not-allowed text-[14px] font-medium"
          >
            {loading ? "..." : "Deposit"}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <label className="text-outline text-[12px] mb-1 block">Withdraw USDC</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-surface-container-low border border-surface-container-high rounded px-3 py-2 text-white font-mono-data text-[14px] focus:outline-none focus:border-outline"
          />
          <button
            onClick={handleWithdraw}
            disabled={loading || !withdrawAmount}
            className="bg-surface-container-high text-white px-4 py-2 rounded hover:bg-surface-variant active:scale-[0.96] transition-transform disabled:opacity-50 disabled:cursor-not-allowed text-[14px] font-medium"
          >
            {loading ? "..." : "Withdraw"}
          </button>
        </div>
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
