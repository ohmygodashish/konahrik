"use client";

export function NetworkFooter() {
  return (
    <footer className="h-8 bg-surface-container-lowest border-t border-surface-container flex items-center justify-end px-4 shrink-0 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="text-outline">Network</span>
        <span className="text-positive font-mono-data">Devnet</span>
      </div>
    </footer>
  );
}
