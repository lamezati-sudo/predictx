"use client";

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { calcLinearPnl } from "@/lib/probability";
import { formatPrice } from "@/types";

export function PredictionPanel() {
  const direction    = useGameStore((s) => s.direction);
  const setDir       = useGameStore((s) => s.setDirection);
  const stake        = useGameStore((s) => s.stake);
  const setStake     = useGameStore((s) => s.setStake);
  const levels       = useGameStore((s) => s.levels);
  const balance      = useGameStore((s) => s.balance);
  const place        = useGameStore((s) => s.placePrediction);
  const asset        = useGameStore((s) => s.asset);
  const timeframe    = useGameStore((s) => s.timeframe);
  const currentPrice = useGameStore((s) => s.currentPrice);
  const targetPrice  = useGameStore((s) => s.targetPrice);
  const activePreds  = useGameStore((s) => s.predictions);
  const windowId     = useGameStore((s) => s.windowId);

  const [stakeInput, setStakeInput] = useState(String(stake));
  const [placing, setPlacing]       = useState(false);

  const hasActive = activePreds.some(
    (p) => p.asset === asset && p.timeframe === timeframe && p.status === "active"
  );

  const canPlace = stake <= balance && stake >= 1 && !hasActive &&
    targetPrice > 0 && !!windowId && !!levels && !placing;

  async function handlePlace() {
    setPlacing(true);
    try { await place(); }
    finally { setPlacing(false); }
  }

  const entryPrice = levels?.entry ?? currentPrice;
  const tpPnl = levels ? calcLinearPnl(stake, entryPrice, levels.takeProfit, direction) : 0;
  const slPnl = levels ? calcLinearPnl(stake, entryPrice, levels.stopLoss,   direction) : 0;

  const isWinning = direction === "above"
    ? currentPrice > targetPrice
    : currentPrice > 0 && currentPrice < targetPrice;

  const pctDelta = targetPrice > 0 && currentPrice > 0
    ? ((currentPrice - targetPrice) / targetPrice * 100)
    : null;

  function handleStakeInput(val: string) {
    setStakeInput(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 1) setStake(n);
  }

  function handleStakeBlur() {
    const n = parseFloat(stakeInput);
    if (isNaN(n) || n < 1) {
      setStakeInput("1");
      setStake(1);
    } else {
      const clamped = Math.min(n, balance);
      setStakeInput(String(clamped));
      setStake(clamped);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto text-[#e2e2e2]">

      {/* ── Live price + price to beat ───────────────────────────── */}
      <div className="border-b border-[#161616] px-4 py-4">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
          {asset} price
        </div>
        <div className="flex items-end justify-between">
          <div>
            <span className="font-mono text-3xl font-bold tabular-nums text-white">
              {currentPrice > 0 ? `$${formatPrice(currentPrice, asset)}` : "—"}
            </span>
            <div className="mt-0.5 text-[11px]"
              style={{ color: isWinning ? "#00c47a" : "#ff3b5b" }}>
              {isWinning ? "IN money" : "OUT of money"} ({direction === "above" ? "UP" : "DOWN"})
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-bold text-white">
              {targetPrice > 0 ? `$${formatPrice(targetPrice, asset)}` : "—"}
            </div>
            {pctDelta !== null && (
              <div className="text-[11px] font-semibold"
                style={{ color: pctDelta >= 0 ? "#00c47a" : "#ff3b5b" }}>
                {pctDelta >= 0 ? "+" : ""}{pctDelta.toFixed(3)}%
              </div>
            )}
            <div className="text-[10px] text-[#2a2a2a]">price to beat</div>
          </div>
        </div>
      </div>

      {/* ── UP / DOWN ────────────────────────────────────────────── */}
      <div className="border-b border-[#161616] px-4 py-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
          {asset} will go
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDir("above")}
            disabled={hasActive}
            className="rounded-lg py-3.5 text-sm font-bold transition-all disabled:opacity-50"
            style={{
              background: direction === "above" ? "#00c47a" : "#0d0d0d",
              color:      direction === "above" ? "#000" : "#444",
              border:     `1px solid ${direction === "above" ? "#00c47a" : "#1c1c1c"}`,
            }}
          >
            ▲ UP
          </button>
          <button
            onClick={() => setDir("below")}
            disabled={hasActive}
            className="rounded-lg py-3.5 text-sm font-bold transition-all disabled:opacity-50"
            style={{
              background: direction === "below" ? "#ff3b5b" : "#0d0d0d",
              color:      direction === "below" ? "#fff" : "#444",
              border:     `1px solid ${direction === "below" ? "#ff3b5b" : "#1c1c1c"}`,
            }}
          >
            ▼ DOWN
          </button>
        </div>
      </div>

      {/* ── Stake input ───────────────────────────────────────────── */}
      <div className="border-b border-[#161616] px-4 py-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
          Stake
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#555]">$</span>
          <input
            type="number"
            min={1}
            max={balance}
            value={stakeInput}
            onChange={(e) => handleStakeInput(e.target.value)}
            onBlur={handleStakeBlur}
            placeholder="0"
            className="w-full rounded border border-[#1e1e1e] bg-[#0a0a0a] px-3 py-2.5 font-mono text-lg font-bold text-white outline-none focus:border-[#2e2e2e]"
          />
        </div>
        <div className="mt-1.5 flex justify-between">
          <p className="text-[10px] text-[#2a2a2a]">
            ${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} available
          </p>
          {entryPrice > 0 && (
            <p className="font-mono text-[10px] text-[#444]">
              entry ≈ ${formatPrice(entryPrice, asset)}
            </p>
          )}
        </div>

        {/* TP / SL P&L preview */}
        {stake >= 1 && levels && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border px-3 py-2.5"
              style={{ background: "rgba(0,196,122,0.05)", borderColor: "rgba(0,196,122,0.15)" }}>
              <div className="text-[10px] text-[#555]">Take profit @ ${formatPrice(levels.takeProfit, asset)}</div>
              <div className="font-mono text-lg font-bold text-[#00c47a]">
                {tpPnl >= 0 ? "+" : ""}${tpPnl.toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2.5"
              style={{ background: "rgba(255,59,91,0.05)", borderColor: "rgba(255,59,91,0.15)" }}>
              <div className="text-[10px] text-[#555]">Stop loss @ ${formatPrice(levels.stopLoss, asset)}</div>
              <div className="font-mono text-lg font-bold text-[#ff3b5b]">
                {slPnl >= 0 ? "+" : ""}${slPnl.toFixed(2)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <div className="mt-auto p-4">
        {hasActive ? (
          <div className="rounded-lg border border-[#1c1c1c] bg-[#0d0d0d] px-4 py-3 text-center text-xs text-[#444]">
            Trade active — drag TP/SL on the chart, or wait for the window to settle
          </div>
        ) : (
          <button
            onClick={handlePlace}
            disabled={!canPlace}
            className="w-full rounded-lg py-4 text-sm font-bold uppercase tracking-widest transition-all"
            style={{
              background: canPlace ? (direction === "above" ? "#00c47a" : "#ff3b5b") : "#0d0d0d",
              color:      canPlace ? (direction === "above" ? "#000" : "#fff") : "#333",
              cursor:     canPlace ? "pointer" : "not-allowed",
              border:     `1px solid ${canPlace ? "transparent" : "#1a1a1a"}`,
            }}
          >
            {placing
              ? "Placing…"
              : !targetPrice || !windowId
              ? "Loading…"
              : `${direction === "above" ? "UP" : "DOWN"} ${asset} @ $${formatPrice(entryPrice, asset)}`}
          </button>
        )}
      </div>
    </div>
  );
}
