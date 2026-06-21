"use client";

import { AccountProvider } from "@/components/AccountProvider";
import { ActivePredictions } from "@/components/ActivePredictions";
import { AssetPicker } from "@/components/AssetPicker";
import { Header } from "@/components/Header";
import { PredictionPanel } from "@/components/PredictionPanel";
import { TimeframePicker } from "@/components/TimeframePicker";
import { ToastStack } from "@/components/ToastStack";
import { TradingWorkspace } from "@/components/TradingWorkspace";
import { useTick } from "@/hooks/useTick";

export default function Home() {
  useTick(1000);

  return (
    <AccountProvider>
    <div className="flex h-screen flex-col overflow-hidden bg-[#080808] text-[#e2e2e2]">
      <Header />
      <ToastStack />

      {/* Chart toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#1a1a1a] bg-[#0d0d0d] px-4 py-2">
        <AssetPicker />
        <TimeframePicker />
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {/* Chart */}
        <div className="relative min-w-0 flex-1 bg-[#0d0d0d]">
          <TradingWorkspace />
        </div>

        {/* Right panel */}
        <div className="flex w-[280px] shrink-0 flex-col border-l border-[#1a1a1a] bg-[#0d0d0d]">
          <PredictionPanel />
        </div>
      </div>

      {/* Bottom bar — active trades */}
      <div className="flex h-32 shrink-0 flex-col border-t border-[#1a1a1a] bg-[#0a0a0a] px-4 py-3">
        <ActivePredictions />
      </div>
    </div>
    </AccountProvider>
  );
}
