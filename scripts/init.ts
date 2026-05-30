import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);

async function main() {
  console.log("🚀 Initializing Konahrik AMM on Devnet...\n");

  // 1. Load wallet
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`📝 Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // 2. Connect to devnet
  const connection = new anchor.web3.Connection(DEVNET_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`💰 Balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL\n`);

  // 3. Load program
  const idlPath = path.join(__dirname, "..", "target", "idl", "konahrik.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const programId = new PublicKey(idl.address);
  const program = new Program(idl, provider);
  console.log(`📦 Program ID: ${programId.toBase58()}\n`);

  // 4. Create USDC mint
  console.log("Creating USDC mint...");
  const usdcMint = await createMint(
    connection,
    walletKeypair,
    walletKeypair.publicKey, // mint authority
    null, // freeze authority
    6 // decimals
  );
  console.log(`✅ USDC Mint: ${usdcMint.toBase58()}\n`);

  // 5. Create deployer's USDC account and mint 10M USDC
  console.log("Creating deployer USDC account...");
  const deployerUsdcAccount = await createAssociatedTokenAccount(
    connection,
    walletKeypair,
    usdcMint,
    walletKeypair.publicKey
  );

  console.log("Minting 10M USDC to deployer...");
  await mintTo(
    connection,
    walletKeypair,
    usdcMint,
    deployerUsdcAccount,
    walletKeypair.publicKey,
    10_000_000 * 1_000_000 // 10M USDC (6 decimals)
  );
  console.log(`✅ Deployer USDC Account: ${deployerUsdcAccount.toBase58()}\n`);

  // 6. Derive PDAs
  const [ammStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_state")],
    programId
  );

  const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    programId
  );

  console.log("Deriving PDAs...");
  console.log(`  AmmState: ${ammStatePDA.toBase58()}`);
  console.log(`  Vault Authority: ${vaultAuthorityPDA.toBase58()}`);

  // 7. Generate vault keypair (program will create the token account)
  console.log("\nGenerating vault keypair...");
  const vaultKeypair = Keypair.generate();
  console.log(`✅ Vault address: ${vaultKeypair.publicKey.toBase58()}\n`);

  // 8. Initialize AMM
  console.log("Initializing AMM...");
  const params = {
    initialBaseReserve: new anchor.BN("1000000000000000"), // 1M SOL * 1e9
    initialQuoteReserve: new anchor.BN("140000000000000"), // 140M USDC * 1e6
    initialMarginBps: 1000, // 10%
    maintMarginBps: 625, // 6.25%
    liquidationFeeBps: 250, // 2.5%
    tradingFeeBps: 10, // 0.1%
    fundingPeriod: new anchor.BN(3600), // 1 hour
  };

  const tx = await program.methods
    .initializeAmm(params)
    .accounts({
      authority: walletKeypair.publicKey,
      ammState: ammStatePDA,
      vault: vaultKeypair.publicKey,
      vaultAuthority: vaultAuthorityPDA,
      usdcMint: usdcMint,
      pythFeed: PYTH_SOL_USD_FEED,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([vaultKeypair])
    .rpc();

  console.log(`✅ AMM Initialized!`);
  console.log(`   Transaction: ${tx}\n`);

  // 9. Summary
  console.log("═".repeat(60));
  console.log("📋 INITIALIZATION SUMMARY");
  console.log("═".repeat(60));
  console.log(`USDC Mint:        ${usdcMint.toBase58()}`);
  console.log(`Program ID:       ${programId.toBase58()}`);
  console.log(`AmmState PDA:     ${ammStatePDA.toBase58()}`);
  console.log(`Vault:            ${vaultKeypair.publicKey.toBase58()}`);
  console.log(`Vault Authority:  ${vaultAuthorityPDA.toBase58()}`);
  console.log(`Deployer Wallet:  ${walletKeypair.publicKey.toBase58()}`);
  console.log("═".repeat(60));
  console.log("\n⚠️  IMPORTANT: Copy the USDC Mint address to:");
  console.log("   app/src/lib/constants.ts → USDC_MINT\n");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
