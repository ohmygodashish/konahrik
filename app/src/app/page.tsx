import { Navbar } from "@/components/Navbar";

export default function Home() {
  return (
    <>
      {/* Navbar */}
      <Navbar />

      {/* Market header placeholder */}
      <div className="h-14 bg-surface-container-lowest border-b border-surface-container flex items-center px-4 shrink-0">
        <span className="text-outline text-[13px]">Market Header</span>
      </div>

      {/* Main terminal layout */}
      <main className="flex-1 flex gap-[1px] bg-surface-container overflow-hidden">
        {/* Left: Chart + Bottom Panel */}
        <div className="flex-1 flex flex-col gap-[1px] min-w-0">
          {/* Chart area */}
          <div className="terminal-panel flex-1 flex items-center justify-center min-h-[300px]">
            <span className="text-outline text-[13px]">Chart Placeholder</span>
          </div>

          {/* Bottom panel */}
          <div className="terminal-panel h-56 shrink-0 flex items-center justify-center">
            <span className="text-outline text-[13px]">
              Bottom Panel (Balances / Positions / History)
            </span>
          </div>
        </div>

        {/* Right: Margin + Trading */}
        <div className="w-[340px] terminal-panel flex flex-col shrink-0 p-4 overflow-y-auto">
          <div className="flex-1 flex items-center justify-center">
            <span className="text-outline text-[13px]">
              Margin + Trading Panel
            </span>
          </div>
        </div>
      </main>

      {/* Footer placeholder */}
      <footer className="h-8 bg-surface-container-lowest border-t border-surface-container flex items-center px-4 shrink-0">
        <span className="text-outline text-[12px]">Protocol Stats Footer</span>
      </footer>
    </>
  );
}
