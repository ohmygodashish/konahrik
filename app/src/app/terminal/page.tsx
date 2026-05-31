"use client";

import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { MarketHeader } from "@/components/MarketHeader";
import { MarginPanel } from "@/components/MarginPanel";
import { TradingPanel } from "@/components/TradingPanel";
import { BottomPanel } from "@/components/BottomPanel";
import { PriceChart } from "@/components/PriceChart";
import { ProtocolStatsFooter } from "@/components/ProtocolStatsFooter";

export default function TerminalPage() {
  return (
    <>
      <MarketHeader />

      <main className="flex-1 overflow-hidden">
        <PanelGroup orientation="horizontal" className="h-full">
          <Panel defaultSize={70} minSize={30}>
            <PanelGroup orientation="vertical" className="h-full">
              <Panel defaultSize={65} minSize={15}>
                <div className="terminal-panel h-full flex flex-col">
                  <PriceChart />
                </div>
              </Panel>
              <PanelResizeHandle className="h-1 bg-surface-container-high hover:bg-electric-indigo transition-colors cursor-row-resize" />
              <Panel defaultSize={35} minSize={10}>
                <BottomPanel />
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="w-1 bg-surface-container-high hover:bg-electric-indigo transition-colors cursor-col-resize" />

          <Panel defaultSize={30} minSize={25} collapsible={false}>
            <div className="terminal-panel h-full flex flex-col p-4 overflow-y-auto">
              <MarginPanel />
              <TradingPanel />
            </div>
          </Panel>
        </PanelGroup>
      </main>
      <ProtocolStatsFooter />
    </>
  );
}
