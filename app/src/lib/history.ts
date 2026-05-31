export interface ClosedPosition {
  positionId: number;
  isLong: boolean;
  size: number;
  notional: number;
  entryPrice: number;
  margin: number;
  closedAt: number;
  txSignature?: string;
}

const STORAGE_KEY = "konahrik_closed_positions";

export function getClosedPositions(walletAddress: string): ClosedPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${walletAddress}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveClosedPosition(
  walletAddress: string,
  position: Omit<ClosedPosition, "closedAt">
): void {
  if (typeof window === "undefined") return;
  const existing = getClosedPositions(walletAddress);
  const closed: ClosedPosition = {
    ...position,
    closedAt: Date.now(),
  };
  const updated = [closed, ...existing];
  localStorage.setItem(
    `${STORAGE_KEY}_${walletAddress}`,
    JSON.stringify(updated)
  );
}
