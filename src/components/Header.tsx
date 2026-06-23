"use client";

import { useGameStore } from "@/store/game-store";
import { levelFromXp, xpProgress } from "@/lib/prediction-engine";
import { calcLinearPnl } from "@/lib/probability";
import { ASSETS } from "@/types";

export function Header() {
  const balance = useGameStore((s) => s.balance);
  const xp = useGameStore((s) => s.xp);
  const streak = useGameStore((s) => s.streak);
  const totalWins = useGameStore((s) => s.totalWins);
  const totalLosses = useGameStore((s) => s.totalLosses);
  const prices      = useGameStore((s) => s.prices);
  const predictions = useGameStore((s) => s.predictions);
  const username    = useGameStore((s) => s.username);

  const level    = levelFromXp(xp);
  const progress = xpProgress(xp);
  const winRate  = totalWins + totalLosses > 0
    ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
    : null;

  // Live unrealized P&L across all open positions
  const unrealizedPnl = predictions
    .filter((p) => p.status === "active")
    .reduce((sum, p) => {
      const livePrice = prices[p.asset] > 0 ? prices[p.asset] : p.entryPrice;
      return sum + calcLinearPnl(p.stake, p.entryPrice, livePrice, p.direction);
    }, 0);

  const lockedStake = predictions.filter((p) => p.status === "active").reduce((s, p) => s + p.stake, 0);
  const equity      = balance + lockedStake + unrealizedPnl;

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#1e1e1e] bg-[#0d0d0d] px-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-tight text-white">PREDICT<span className="text-[#f0b90b]">X</span></span>
        <span className="hidden h-4 w-px bg-[#222] sm:block" />
        {/* Live asset prices */}
        <div className="hidden items-center gap-4 sm:flex">
          {ASSETS.map((a) => {
            const p = prices[a.id];
            return p > 0 ? (
              <div key={a.id} className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-[#555]">{a.id}</span>
                <span className="font-mono text-[12px] font-semibold text-[#e2e2e2]">
                  ${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ) : null;
          })}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-1 md:flex">
          <span className="text-[11px] text-[#555]">equity</span>
          <span className="font-mono text-[12px] font-semibold text-white">
            ${equity.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {lockedStake > 0 && (
          <div className="hidden items-center gap-1 md:flex">
            <span className="text-[11px] text-[#555]">P&amp;L</span>
            <span className="font-mono text-[12px] font-semibold"
              style={{ color: unrealizedPnl >= 0 ? "#00c47a" : "#ff3b5b" }}>
              {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
            </span>
          </div>
        )}

        <div className="hidden items-center gap-1 md:flex">
          <span className="text-[11px] text-[#555]">lvl</span>
          <span className="font-mono text-[12px] font-semibold text-white">{level}</span>
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#222]">
            <div
              className="h-full rounded-full bg-[#f0b90b]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>

        {streak > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[11px]">🔥</span>
            <span className="font-mono text-[12px] font-semibold text-[#f0b90b]">{streak}</span>
          </div>
        )}

        {winRate !== null && (
          <div className="hidden items-center gap-1 md:flex">
            <span className="text-[11px] text-[#555]">win rate</span>
            <span className="font-mono text-[12px] font-semibold text-white">{winRate}%</span>
          </div>
        )}

        {username && (
          <span className="hidden text-[11px] text-[#777] sm:inline">@{username}</span>
        )}

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-[#222] bg-[#111] px-2.5 py-1 text-[11px] text-[#555] transition hover:border-[#333] hover:text-[#aaa]"
          >
            log out
          </button>
        </form>
      </div>
    </header>
  );
}
