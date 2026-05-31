import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const SCALE_1E9 = 1_000_000_000n;
const SCALE_1E6 = 1_000_000n;

interface ConfigArgs {
  fundingPeriod?: number;
  initialMarginBps?: number;
  maintMarginBps?: number;
  tradingFeeBps?: number;
  liquidationFeeBps?: number;
  baseReserve?: bigint;
  quoteReserve?: bigint;
  price?: number;
  show: boolean;
}

function parseArgs(): ConfigArgs {
  const args = process.argv.slice(2);
  const result: ConfigArgs = { show: false };

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.includes("--show")) {
    result.show = true;
    return result;
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--funding-period":
        result.fundingPeriod = parseInt(args[++i], 10);
        break;
      case "--initial-margin":
        result.initialMarginBps = parseInt(args[++i], 10);
        break;
      case "--maint-margin":
        result.maintMarginBps = parseInt(args[++i], 10);
        break;
      case "--trading-fee":
        result.tradingFeeBps = parseInt(args[++i], 10);
        break;
      case "--liquidation-fee":
        result.liquidationFeeBps = parseInt(args[++i], 10);
        break;
      case "--base-reserve":
        result.baseReserve = BigInt(args[++i]);
        break;
      case "--quote-reserve":
        result.quoteReserve = BigInt(args[++i]);
        break;
      case "--price":
        result.price = parseFloat(args[++i]);
        break;
    }
  }

  return result;
}

function printUsage() {
  console.log(`
Konahrik Config Updater

Usage: ts-node scripts/update-config.ts [options]

Config options:
  --funding-period <seconds>    Update funding period (e.g., 5)
  --initial-margin <bps>        Update initial margin in bps (e.g., 1000 = 10%)
  --maint-margin <bps>          Update maintenance margin in bps (e.g., 625 = 6.25%)
  --trading-fee <bps>           Update trading fee in bps (e.g., 10 = 0.1%)
  --liquidation-fee <bps>       Update liquidation fee in bps (e.g., 250 = 2.5%)

Reserve options (re-align mark price with index):
  --base-reserve <value>        Base asset reserve (lamports, e.g. 1000000000000000)
  --quote-reserve <value>       Quote asset reserve (USDC 1e6, e.g. 80000000000000)
  --price <dollars>             Target SOL price (e.g. 80). Computes quote_reserve from current base_reserve.

Other:
  --show                        Show current config (no changes)
  -h, --help                    Show this help message

Examples:
  ts-node scripts/update-config.ts --funding-period 5
  ts-node scripts/update-config.ts --price 80
  ts-node scripts/update-config.ts --price 80 --funding-period 5
  ts-node scripts/update-config.ts --show
`);
}

async function main() {
  const args = parseArgs();

  console.log("Konahrik Config Updater\n");

  // 1. Load wallet
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`Wallet:  ${walletKeypair.publicKey.toBase58()}`);

  // 2. Connect to devnet
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(walletKeypair),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // 3. Load program
  const idlPath = path.join(__dirname, "..", "target", "idl", "konahrik.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const programId = new PublicKey(idl.address);
  const program = new Program(idl, provider);
  console.log(`Program: ${programId.toBase58()}\n`);

  // 4. Derive AmmState PDA
  const [ammStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_state")],
    programId
  );

  // 5. Fetch current state
  console.log("Fetching current config...");
  const ammState = await (program.account as any).ammState.fetch(ammStatePDA);

  const currentBase = BigInt(ammState.baseAssetReserve.toString());
  const currentQuote = BigInt(ammState.quoteAssetReserve.toString());
  const currentPrice = Number((currentQuote * 1000n) / currentBase);

  console.log("\n" + "=".repeat(50));
  console.log("CURRENT CONFIG");
  console.log("=".repeat(50));
  console.log(`  Authority:           ${ammState.authority.toBase58()}`);
  console.log(`  Initial Margin:      ${ammState.initialMarginBps} bps (${ammState.initialMarginBps / 100}%)`);
  console.log(`  Maint Margin:        ${ammState.maintMarginBps} bps (${ammState.maintMarginBps / 100}%)`);
  console.log(`  Trading Fee:         ${ammState.tradingFeeBps} bps (${ammState.tradingFeeBps / 100}%)`);
  console.log(`  Liquidation Fee:     ${ammState.liquidationFeeBps} bps (${ammState.liquidationFeeBps / 100}%)`);
  console.log(`  Funding Period:      ${ammState.fundingPeriod} seconds`);
  console.log(`  Base Reserve:        ${currentBase.toString()} (${Number(currentBase) / Number(SCALE_1E9)} SOL)`);
  console.log(`  Quote Reserve:       ${currentQuote.toString()} (${Number(currentQuote) / Number(SCALE_1E6)} USDC)`);
  console.log(`  Mark Price:          $${currentPrice}`);
  console.log("=".repeat(50));

  // Check if wallet is the authority
  if (!ammState.authority.equals(walletKeypair.publicKey)) {
    console.error(`\nError: Wallet is not the AMM authority.`);
    console.error(`   Authority: ${ammState.authority.toBase58()}`);
    console.error(`   Your wallet: ${walletKeypair.publicKey.toBase58()}`);
    process.exit(1);
  }

  if (args.show) {
    process.exit(0);
  }

  // 6. Build update params
  const updateParams: Record<string, any> = {
    fundingPeriod: args.fundingPeriod !== undefined ? new anchor.BN(args.fundingPeriod) : null,
    initialMarginBps: args.initialMarginBps ?? null,
    maintMarginBps: args.maintMarginBps ?? null,
    tradingFeeBps: args.tradingFeeBps ?? null,
    liquidationFeeBps: args.liquidationFeeBps ?? null,
    baseReserve: null,
    quoteReserve: null,
  };

  let newBase = currentBase;
  let newQuote = currentQuote;
  if (args.baseReserve !== undefined) {
    newBase = args.baseReserve;
    updateParams.baseReserve = new anchor.BN(newBase.toString());
  }
  if (args.quoteReserve !== undefined) {
    newQuote = args.quoteReserve;
    updateParams.quoteReserve = new anchor.BN(newQuote.toString());
  }
  if (args.price !== undefined) {
    newQuote = newBase * BigInt(Math.floor(args.price * 1000)) / 1000n;
    updateParams.quoteReserve = new anchor.BN(newQuote.toString());
    console.log(`\nTarget price $${args.price} → quote = ${newQuote.toString()}`);
  }

  const hasUpdates =
    args.fundingPeriod !== undefined ||
    args.initialMarginBps !== undefined ||
    args.maintMarginBps !== undefined ||
    args.tradingFeeBps !== undefined ||
    args.liquidationFeeBps !== undefined ||
    args.baseReserve !== undefined ||
    args.quoteReserve !== undefined ||
    args.price !== undefined;

  if (!hasUpdates) {
    console.log("\nNo changes specified. Use --help to see options.");
    process.exit(0);
  }

  const newPrice = Number((newQuote * 1000n) / newBase);

  console.log("\nUpdates to apply:");
  if (args.fundingPeriod !== undefined) console.log(`   fundingPeriod: ${ammState.fundingPeriod} → ${args.fundingPeriod}s`);
  if (args.initialMarginBps !== undefined) console.log(`   initialMarginBps: ${ammState.initialMarginBps} → ${args.initialMarginBps}`);
  if (args.maintMarginBps !== undefined) console.log(`   maintMarginBps: ${ammState.maintMarginBps} → ${args.maintMarginBps}`);
  if (args.tradingFeeBps !== undefined) console.log(`   tradingFeeBps: ${ammState.tradingFeeBps} → ${args.tradingFeeBps}`);
  if (args.liquidationFeeBps !== undefined) console.log(`   liquidationFeeBps: ${ammState.liquidationFeeBps} → ${args.liquidationFeeBps}`);
  if (args.baseReserve !== undefined || args.quoteReserve !== undefined || args.price !== undefined) {
    console.log(`   Base Reserve:  ${currentBase.toString()} → ${newBase.toString()} (${Number(newBase) / Number(SCALE_1E9)} SOL)`);
    console.log(`   Quote Reserve: ${currentQuote.toString()} → ${newQuote.toString()} (${Number(newQuote) / Number(SCALE_1E6)} USDC)`);
    console.log(`   Mark Price:    $${currentPrice} → $${newPrice}`);
  }

  // 7. Send update transaction
  console.log("\nSending transaction...");
  const tx = await program.methods
    .updateConfig(updateParams)
    .accounts({
      authority: walletKeypair.publicKey,
      ammState: ammStatePDA,
    })
    .rpc();

  console.log(`Config updated!`);
  console.log(`  Transaction: ${tx}\n`);

  // 8. Fetch and display new config
  const updatedState = await (program.account as any).ammState.fetch(ammStatePDA);
  const updatedBase = BigInt(updatedState.baseAssetReserve.toString());
  const updatedQuote = BigInt(updatedState.quoteAssetReserve.toString());
  const updatedPrice = Number((updatedQuote * 1000n) / updatedBase);

  console.log("=".repeat(50));
  console.log("UPDATED CONFIG");
  console.log("=".repeat(50));
  console.log(`  Initial Margin:      ${updatedState.initialMarginBps} bps (${updatedState.initialMarginBps / 100}%)`);
  console.log(`  Maint Margin:        ${updatedState.maintMarginBps} bps (${updatedState.maintMarginBps / 100}%)`);
  console.log(`  Trading Fee:         ${updatedState.tradingFeeBps} bps (${updatedState.tradingFeeBps / 100}%)`);
  console.log(`  Liquidation Fee:     ${updatedState.liquidationFeeBps} bps (${updatedState.liquidationFeeBps / 100}%)`);
  console.log(`  Funding Period:      ${updatedState.fundingPeriod} seconds`);
  console.log(`  Base Reserve:        ${updatedBase.toString()} (${Number(updatedBase) / Number(SCALE_1E9)} SOL)`);
  console.log(`  Quote Reserve:       ${updatedQuote.toString()} (${Number(updatedQuote) / Number(SCALE_1E6)} USDC)`);
  console.log(`  Mark Price:          $${updatedPrice}`);
  console.log("=".repeat(50));
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
