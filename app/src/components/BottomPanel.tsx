"use client";

import { useState } from "react";
import { BalancesTab } from "./BalancesTab";
import { PositionsTab } from "./PositionsTab";
import { HistoryTab } from "./HistoryTab";

type Tab = "balances" | "positions" | "history";

export function BottomPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("positions");

  return (
    <div className="terminal-panel h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-surface-container px-4">
        <button
          onClick={() => setActiveTab("balances")}
          className={`py-3 px-4 text-[13px] font-medium ${
            activeTab === "balances" ? "tab-active" : "tab-inactive"
          }`}
        >
          Balances
        </button>
        <button
          onClick={() => setActiveTab("positions")}
          className={`py-3 px-4 text-[13px] font-medium ${
            activeTab === "positions" ? "tab-active" : "tab-inactive"
          }`}
        >
          Positions
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`py-3 px-4 text-[13px] font-medium ${
            activeTab === "history" ? "tab-active" : "tab-inactive"
          }`}
        >
          History
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "balances" && <BalancesTab />}
        {activeTab === "positions" && <PositionsTab />}
        {activeTab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}
