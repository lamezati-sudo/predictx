"use client";

import { useState } from "react";
import { useGameStore } from "@/store/game-store";
import { calcPnl } from "@/lib/probability";
import { streakMultiplier } from "@/lib/prediction-engine";

export function PredictionPanel() {
  const direction    = useGameStore((s) => s.direction);
  const setDir       = useGameStore((s) => s.setDirection);
  const stake        = useGameStore((s) => s.stake);
  const setStake     = useGameStore((s) => s.setStake);
  const levels       = useGameStore((s) => s.levels);
  const balance      = useGameStore((s) => s.balance);
  const streak       = useGameStore((s) => s.streak);
  const place        = useGameStore((s) => s.placePrediction);
  const asset        = useGameStore((s) => s.asset);
  const timeframe    = useGameStore((s) => s.timeframe);
  const currentPrice = useGameStore((s) => s.currentPrice);
  const targetPrice  = useGameStore((s) => s.targetPrice);
  const currentProb  = useGameStore((s) => s.currentProb);
  const activePreds  = useGameStore((s) => s.predictions);
  const windowId     = useGameStore((s) => s.windowId);

  // Local input string so user can freely type
  const [stakeInput, setStakeInput] = useState(String(stake));
  const [placing, setPlacing]       = useState(false);

  const hasActive = activePreds.some(
    (p) => p.asset === asset && p.timeframe === timeframe && p.status === "active"
  );

  const canPlace = stake <= balance && stake >= 1 && !hasActive &&
    targetPrice > 0 && !!windowId && !placing;

  async function handlePlace() {
    setPlacing(true);
    try { await place(); }
    finally { setPlacing(false); }
  }

  const mult   = streakMultiplier(streak);
  const entryP = levels?.entry ?? currentProb;

  // Win payout at window close (exit at 0.98)
  const winPnl = calcPnl(stake, entryP, 0.98) * mult;

  // Price delta from target
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

      {/* ── Live probability display ─────────────────────────────── */}
      <div className="border-b border-[#161616] px-4 py-4">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
          Market odds
        </div>
        <div className="flex items-end justify-between">
          <div>
            <span
              className="font-mono text-3xl font-bold tabular-nums"
              style={{ color: currentProb >= 0.5 ? "#00c47a" : "#ff3b5b" }}
            >
              {Math.round(currentProb * 100)}¢
            </span>
            <div className="mt-0.5 text-[11px] text-[#3a3a3a]">
              P({direction.toUpperCase()}) — {currentProb >= 0.5 ? "favoured" : "underdog"}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-bold text-white">
              ${targetPrice > 0
                ? targetPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })
                : "—"}
            </div>
            {pctDelta !== null && (
              <div className="text-[11px] font-semibold"
                style={{ color: pctDelta >= 0 ? "#00c47a" : "#ff3b5b" }}>
                {pctDelta >= 0 ? "+" : ""}{pctDelta.toFixed(3)}%
              </div>
            )}
            <div className="text-[10px] text-[#2a2a2a]">target</div>
          </div>
        </div>

        {/* Probability bar */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#111]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.round(currentProb * 100)}%`,
              background: currentProb >= 0.5
                ? "linear-gradient(to right,#00c47a88,#00c47a)"
                : "linear-gradient(to right,#ff3b5b,#ff3b5b88)",
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[9px] text-[#2a2a2a]">
          <span>0¢</span><span>50¢</span><span>100¢</span>
        </div>
      </div>

      {/* ── ABOVE / BELOW ────────────────────────────────────────── */}
      <div className="border-b border-[#161616] px-4 py-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#3a3a3a]">
          {asset} will close
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDir("above")}
            className="rounded-lg py-3.5 text-sm font-bold transition-all"
            style={{
              background: direction === "above" ? "#00c47a" : "#0d0d0d",
              color:      direction === "above" ? "#000" : "#444",
              border:     `1px solid ${direction === "above" ? "#00c47a" : "#1c1c1c"}`,
            }}
          >
            ▲ ABOVE
          </button>
          <button
            onClick={() => setDir("below")}
            className="rounded-lg py-3.5 text-sm font-bold transition-all"
            style={{
              background: direction === "below" ? "#ff3b5b" : "#0d0d0d",
              color:      direction === "below" ? "#fff" : "#444",
              border:     `1px solid ${direction === "below" ? "#ff3b5b" : "#1c1c1c"}`,
            }}
          >
            ▼ BELOW
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
          {entryP > 0 && stake >= 1 && (
            <p className="font-mono text-[10px] text-[#444]">
              ≈ {Math.round(stake / entryP)} contracts @ {Math.round(entryP * 100)}¢
            </p>
          )}
        </div>

        {/* Payout if correct */}
        {stake >= 1 && entryP > 0 && (
          <div
            className="mt-3 flex items-center justify-between rounded-lg border px-4 py-3"
            style={{
              background: "rgba(0,196,122,0.05)",
              borderColor: "rgba(0,196,122,0.15)",
            }}
          >
            <div>
              <div className="text-[11px] text-[#555]">You receive if correct</div>
              {streak >= 3 && (
                <div className="text-[10px] text-[#f0b90b]">🔥 {mult}× streak bonus</div>
              )}
            </div>
            <div className="text-right">
              <div className="font-mono text-xl font-bold text-[#00c47a]">
                ${(stake + winPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[10px] text-[#444]">
                +${winPnl.toFixed(2)} profit · {((winPnl / stake) * 100).toFixed(0)}% return
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <div className="mt-auto p-4">
        {hasActive ? (
          <div className="rounded-lg border border-[#1c1c1c] bg-[#0d0d0d] px-4 py-3 text-center text-xs text-[#444]">
            Trade active — wait for window to settle
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
              : `${direction.toUpperCase()} ${asset} @ ${Math.round(entryP * 100)}¢`}
          </button>
        )}
      </div>
    </div>
  );
}

