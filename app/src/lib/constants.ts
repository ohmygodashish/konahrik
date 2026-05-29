import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk"
);

export const PYTH_SOL_USD_FEED = new PublicKey(
  "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
);

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const LOCALNET_RPC = "http://localhost:8899";

export const INITIAL_BASE_RESERVE = 1_000_000n * 1_000_000_000n;
export const INITIAL_QUOTE_RESERVE = 140_000_000n * 1_000_000n;

export const SCALE_1E6 = 1_000_000n;
export const SCALE_1E9 = 1_000_000_000n;

export const POLLING_INTERVAL_MS = 3000;
