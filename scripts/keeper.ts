import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Konahrik Keeper — Funding Rate Updater\n");

  // 1. Load wallet
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`Keeper:  ${walletKeypair.publicKey.toBase58()}`);

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

  // 4. Derive AmmState PDA
  const [ammStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("amm_state")],
    programId
  );

  // 5. Fetch funding period
  const ammState = await (program.account as any).ammState.fetch(ammStatePDA);
  const fundingPeriod = ammState.fundingPeriod;
  console.log(`Funding period: ${fundingPeriod} seconds\n`);

  let count = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const tx = await program.methods
        .updateFunding()
        .accounts({
          ammState: ammStatePDA,
          pythPriceFeed: PYTH_SOL_USD_FEED,
        })
        .rpc();

      count++;
      const updated = await (program.account as any).ammState.fetch(ammStatePDA);
      const cumulativeRate = Number(updated.cumulativeFundingRate) / 1_000_000_000;
      console.log(
        `[${count}] Funding updated → tx: ${tx.slice(0, 12)}... | cumulative rate: ${cumulativeRate.toExponential(4)}`
      );
    } catch (err: any) {
      if (err.message?.includes("0x1788")) {
        console.log(`[${count + 1}] Funding not due yet, waiting...`);
      } else {
        console.error(`[${count + 1}] Error:`, err.message ?? err);
      }
    }

    await sleep((fundingPeriod + 1) * 1000);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
