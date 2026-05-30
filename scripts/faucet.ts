import * as anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: ts-node scripts/faucet.ts <wallet_address> [amount]");
    console.log("  wallet_address: Target wallet to receive test USDC");
    console.log("  amount: USDC amount (default: 10000)");
    console.log("\nExample: ts-node scripts/faucet.ts DrXHa48LDLQTgfJpoYWNy2mu9KMy1h3EHJHaYzQZvhsK 5000");
    process.exit(1);
  }

  const targetWallet = new PublicKey(args[0]);
  const amount = args[1] ? parseFloat(args[1]) : 10000;

  console.log(`💧 Konahrik Test USDC Faucet\n`);
  console.log(`Target Wallet: ${targetWallet.toBase58()}`);
  console.log(`Amount: ${amount} USDC\n`);

  // 1. Load mint authority wallet
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`📝 Mint Authority: ${walletKeypair.publicKey.toBase58()}`);

  // 2. Connect to devnet
  const connection = new anchor.web3.Connection(DEVNET_RPC, "confirmed");

  // 3. Load USDC mint from constants
  const constantsPath = path.join(__dirname, "..", "app", "src", "lib", "constants.ts");
  const constantsContent = fs.readFileSync(constantsPath, "utf-8");
  const mintMatch = constantsContent.match(/export const USDC_MINT = new PublicKey\(\s*"([^"]+)"\s*\)/);

  if (!mintMatch) {
    console.error("❌ USDC_MINT not found in constants.ts");
    console.error("   Run scripts/init.ts first and copy the mint address to constants.ts");
    process.exit(1);
  }

  const usdcMint = new PublicKey(mintMatch[1]);
  console.log(`💵 USDC Mint: ${usdcMint.toBase58()}\n`);

  // 4. Check if token account exists, create if needed
  console.log("Checking target USDC account...");
  const targetUsdcAccount = await getAssociatedTokenAddress(usdcMint, targetWallet);

  try {
    // Check if account exists
    await getAccount(connection, targetUsdcAccount);
    console.log(`✅ USDC account exists: ${targetUsdcAccount.toBase58()}\n`);
  } catch (err: any) {
    // Account doesn't exist, create it
    if (err.name === "TokenAccountNotFoundError" || err.name === "TokenInvalidAccountOwnerError") {
      console.log("Creating USDC account...");
      await createAssociatedTokenAccount(
        connection,
        walletKeypair,
        usdcMint,
        targetWallet
      );
      console.log(`✅ Created USDC account: ${targetUsdcAccount.toBase58()}\n`);
    } else {
      throw err;
    }
  }

  // 5. Mint USDC
  console.log(`Minting ${amount} USDC...`);
  const tx = await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    targetUsdcAccount,
    walletKeypair.publicKey,
    Math.floor(amount * 1_000_000) // 6 decimals
  );

  console.log(`✅ Minted ${amount} USDC!`);
  console.log(`   Transaction: ${tx}\n`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
