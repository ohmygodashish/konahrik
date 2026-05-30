import { Navbar } from "@/components/Navbar";
import { MarketHeader } from "@/components/MarketHeader";
import { MarginPanel } from "@/components/MarginPanel";
import { TradingPanel } from "@/components/TradingPanel";
import { BottomPanel } from "@/components/BottomPanel";
import { ProtocolStatsFooter } from "@/components/ProtocolStatsFooter";

export default function Home() {
  return (
    <>
      {/* Navbar */}
      <Navbar />

      {/* Market header */}
      <MarketHeader />

      {/* Main terminal layout */}
      <main className="flex-1 flex gap-[1px] bg-surface-container overflow-hidden">
        {/* Left: Chart + Bottom Panel */}
        <div className="flex-1 flex flex-col gap-[1px] min-w-0">
          {/* Chart area */}
          <div className="terminal-panel flex-1 flex items-center justify-center min-h-[300px]">
            <span className="text-outline text-[13px]">Chart Placeholder</span>
          </div>

          {/* Bottom panel */}
          <BottomPanel />
        </div>

        {/* Right: Margin + Trading */}
        <div className="w-[340px] terminal-panel flex flex-col shrink-0 p-4 overflow-y-auto">
          <MarginPanel />
          <TradingPanel />
        </div>
      </main>

      {/* Footer */}
      <ProtocolStatsFooter />
    </>
  );
}
