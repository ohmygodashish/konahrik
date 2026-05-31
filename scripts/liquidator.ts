import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);
const POSITION_ACCOUNT_SIZE = 112; // 8 (discriminator) + 104 (InitSpace)

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Konahrik Liquidator — Permissionless Liquidation Bot\n");

  // 1. Load wallet
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`Liquidator: ${walletKeypair.publicKey.toBase58()}`);

  // 2. Connect to devnet
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // 3. Load program
  const idlPath = path.join(__dirname, "..", "target", "idl", "konahrik.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const programId = new PublicKey(idl.address);
  const program = new Program(idl, provider);
  console.log(`Program: ${programId.toBase58()}\n`);

  // 4. Derive PDAs
  const [ammStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_state")],
    programId
  );
  const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    programId
  );

  // 5. Fetch AmmState
  const ammState = await (program.account as any).ammState.fetch(ammStatePDA);
  const usdcMint = ammState.usdcMint;
  const vault = ammState.vault;
  const maintMarginBps = ammState.maintMarginBps;
  console.log(`USDC Mint:   ${usdcMint.toBase58()}`);
  console.log(`Vault:       ${vault.toBase58()}`);
  console.log(`Maint Margin: ${maintMarginBps} bps (${maintMarginBps / 100}%)\n`);

  // 6. Get or create liquidator's USDC token account
  const liquidatorUsdcAccount = await getAssociatedTokenAddress(
    usdcMint,
    walletKeypair.publicKey
  );
  try {
    const info = await connection.getAccountInfo(liquidatorUsdcAccount);
    if (!info) {
      console.log("Creating liquidator USDC account...");
      await createAssociatedTokenAccount(
        connection,
        walletKeypair,
        usdcMint,
        walletKeypair.publicKey
      );
      console.log(`✅ Created: ${liquidatorUsdcAccount.toBase58()}\n`);
    } else {
      console.log(`✅ USDC account exists: ${liquidatorUsdcAccount.toBase58()}\n`);
    }
  } catch {
    console.log("Creating liquidator USDC account...");
    await createAssociatedTokenAccount(
      connection,
      walletKeypair,
      usdcMint,
      walletKeypair.publicKey
    );
    console.log(`✅ Created: ${liquidatorUsdcAccount.toBase58()}\n`);
  }

  let totalLiquidated = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Refresh AmmState for latest reserves and margin config
      const currentAmmState = await (program.account as any).ammState.fetch(
        ammStatePDA
      );
      const currentMaintBps = currentAmmState.maintMarginBps;

      // Get all Position accounts
      const programAccounts = await connection.getProgramAccounts(programId, {
        filters: [{ dataSize: POSITION_ACCOUNT_SIZE }],
      });

      if (programAccounts.length === 0) {
        console.log(`[${new Date().toISOString()}] No positions found, sleeping...`);
        await sleep(10000);
        continue;
      }

      for (const { pubkey } of programAccounts) {
        let pos: any;
        try {
          pos = await (program.account as any).position.fetch(pubkey);
        } catch {
          continue; // Not a valid Position account
        }

        // Compute mark price (1e6 scale) — same formula as on-chain
        const markPrice =
          (currentAmmState.quoteAssetReserve.toNumber() * 1_000_000_000) /
          currentAmmState.baseAssetReserve.toNumber();

        // Compute unrealized PnL (1e6 scale) — same formula as liquidate.rs
        const entryPrice = pos.entryPrice;
        const size = pos.size;
        let unrealizedPnl: number;
        if (pos.isLong) {
          unrealizedPnl = ((markPrice - entryPrice) * size) / 1_000_000_000;
        } else {
          unrealizedPnl = ((entryPrice - markPrice) * size) / 1_000_000_000;
        }

        // Compute margin ratio in BPS
        const marginRatioBps =
          ((pos.margin + unrealizedPnl) * 10_000) / pos.notional;

        if (marginRatioBps >= currentMaintBps) continue;

        // Position is liquidatable — derive PDAs and call liquidate
        const [positionOwnerMarginPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("margin"), pos.owner.toBuffer()],
          programId
        );

        console.log(
          `\n💀 Liquidatable position #${pos.positionId} (${pos.isLong ? "LONG" : "SHORT"}): ` +
            `margin_ratio=${(marginRatioBps / 100).toFixed(2)}% ` +
            `< maint=${(currentMaintBps / 100).toFixed(2)}%`
        );

        try {
          const tx = await program.methods
            .liquidate({
              positionOwner: pos.owner,
              positionId: pos.positionId,
            })
            .accounts({
              liquidator: walletKeypair.publicKey,
              liquidatorUsdcAccount,
              positionOwnerMargin: positionOwnerMarginPDA,
              position: pubkey,
              ammState: ammStatePDA,
              vault,
              vaultAuthority: vaultAuthorityPDA,
              pythPriceFeed: PYTH_SOL_USD_FEED,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

          totalLiquidated++;
          console.log(
            `✅ Liquidated #${pos.positionId} → tx: ${tx.slice(0, 12)}... ` +
              `(total: ${totalLiquidated})`
          );
        } catch (liqErr: any) {
          console.error(
            `❌ Failed to liquidate #${pos.positionId}: ${liqErr.message?.slice(0, 80) ?? liqErr}`
          );
        }
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}] Scan error: ${err.message?.slice(0, 100) ?? err}`);
    }

    await sleep(10000);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
