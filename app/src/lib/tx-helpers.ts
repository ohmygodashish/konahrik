import { toast } from "sonner";
import { DEVNET_RPC } from "./constants";

export async function submitTransaction<T>(
  fn: () => Promise<T>,
  label: string,
  opts?: { onSuccess?: (result: T) => void }
): Promise<T | null> {
  const id = toast.loading(`Confirming ${label}...`);

  try {
    const result = await fn();
    toast.success(`${label} successful`, { id });
    opts?.onSuccess?.(result);
    return result;
  } catch (err: any) {
    const msg = parseAnchorError(err);
    toast.error(msg, { id });
    console.error(`${label} failed:`, err);
    return null;
  }
}

function parseAnchorError(err: any): string {
  const str = err?.toString?.() ?? String(err);

  if (str.includes("User rejected")) return "Transaction rejected by wallet";
  if (str.includes("InsufficientMargin")) return "Insufficient margin";
  if (str.includes("InsufficientAmount")) return "Amount must be greater than zero";
  if (str.includes("InvalidLeverage")) return "Leverage must be 1-10x";
  if (str.includes("SlippageExceeded")) return "Slippage tolerance exceeded";
  if (str.includes("PositionNotLiquidatable")) return "Position is not liquidatable";
  if (str.includes("FundingNotDue")) return "Funding period not elapsed";
  if (str.includes("Unauthorized")) return "Not authorized";
  if (str.includes("WithdrawalExceedsAvailable")) return "Withdrawal exceeds available balance";
  if (str.includes("SelfLiquidation")) return "Cannot liquidate own position";
  if (str.includes("InsufficientLiquidity")) return "Insufficient liquidity in vAMM";
  if (str.includes("OracleStaleness")) return "Oracle price is stale";
  if (str.includes("0x1")) return "Transaction failed - insufficient SOL for fees";

  return "Transaction failed";
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
