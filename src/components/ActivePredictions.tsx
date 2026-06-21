"use client";

import { useGameStore } from "@/store/game-store";
import { calcDirectionProb, calcPnl } from "@/lib/probability";
import { formatUsd } from "@/types";
import { TIMEFRAME_MS } from "@/types";

function fmt(ms: number) {
  if (ms <= 0) return "closing…";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ActivePredictions() {
  const predictions = useGameStore((s) => s.predictions);
  const history     = useGameStore((s) => s.history);
  const prices      = useGameStore((s) => s.prices);

  if (predictions.length === 0 && history.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-xs text-[#2a2a2a]">No predictions yet — place one above</span>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-6 overflow-hidden">
      {/* Active */}
      {predictions.length > 0 && (
        <section className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-[#3a3a3a]">
            Active ({predictions.length})
          </div>
          <div className="space-y-1.5 overflow-y-auto">
            {predictions.map((p) => {
              const livePrice   = prices[p.asset];
              const msRemaining = Math.max(0, p.expiresAt - Date.now());
              const totalMs     = TIMEFRAME_MS[p.timeframe];

              // Live probability of user's direction right now
              const dirProb = livePrice > 0
                ? calcDirectionProb(p.direction, livePrice, p.targetPrice, msRemaining, totalMs)
                : p.entryProb;

              // Mark-to-market PnL (what you'd get if you closed NOW)
              const unrealizedPnl = calcPnl(p.stake, p.entryProb, dirProb);
              const isGaining     = unrealizedPnl >= 0;

              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded bg-[#0d0d0d] px-3 py-2"
                  style={{ borderLeft: `2px solid ${isGaining ? "#00c47a" : "#ff3b5b"}` }}
                >
                  {/* Direction */}
                  <span className="shrink-0 text-xs font-bold"
                    style={{ color: p.direction === "above" ? "#00c47a" : "#ff3b5b" }}>
                    {p.direction === "above" ? "▲" : "▼"} {p.direction.toUpperCase()}
                  </span>

                  {/* Asset + entry prob */}
                  <span className="text-[11px] text-[#444]">
                    {p.asset}
                    <span className="ml-1.5 font-mono text-[#555]">
                      @{Math.round(p.entryProb * 100)}¢
                    </span>
                  </span>

                  {/* Live prob */}
                  <span className="font-mono text-[11px] font-bold"
                    style={{ color: isGaining ? "#00c47a" : "#ff3b5b" }}>
                    {Math.round(dirProb * 100)}¢
                  </span>

                  <div className="ml-auto flex items-center gap-3">
                    {/* Live P&L */}
                    <span className="font-mono text-xs font-bold"
                      style={{ color: isGaining ? "#00c47a" : "#ff3b5b" }}>
                      {formatUsd(unrealizedPnl)}
                    </span>
                    {/* Countdown */}
                    <span className="font-mono text-[11px] text-[#f0b90b]">
                      {fmt(msRemaining)}
                    </span>
                    {/* Stake */}
                    <span className="text-[11px] text-[#444]">${p.stake}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section className="flex w-60 shrink-0 flex-col gap-1">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-[#3a3a3a]">
            History
          </div>
          <div className="space-y-0.5 overflow-y-auto">
            {history.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-1 py-1">
                <span className="text-[11px] text-[#444]">
                  {p.direction.toUpperCase()} {p.asset}
                  <span className="ml-1 text-[#2a2a2a]">
                    · {p.exitReason} · {Math.round(p.entryProb * 100)}¢→{Math.round((p.exitProb ?? 0) * 100)}¢
                  </span>
                </span>
                <span className="font-mono text-[11px] font-semibold"
                  style={{ color: (p.pnl ?? 0) >= 0 ? "#00c47a" : "#ff3b5b" }}>
                  {formatUsd(p.pnl ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
