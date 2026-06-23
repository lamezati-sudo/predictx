import type { ActivePrediction } from "@/types";
import { calcLinearPnl } from "@/lib/probability";

const XP_PER_WIN   = 25;
const XP_PER_LEVEL = 400;

// ─── Trigger checks ────────────────────────────────────────────────────────

/**
 * Check if the live price has crossed a TP or SL price level.
 * UP   → TP when price ≥ tpPrice, SL when price ≤ slPrice.
 * DOWN → TP when price ≤ tpPrice, SL when price ≥ slPrice.
 */
export function checkPredictionTriggers(
  prediction: ActivePrediction,
  price: number
): "tp" | "sl" | null {
  if (prediction.status !== "active") return null;
  if (prediction.direction === "above") {
    if (price >= prediction.tpPrice) return "tp";
    if (price <= prediction.slPrice) return "sl";
  } else {
    if (price <= prediction.tpPrice) return "tp";
    if (price >= prediction.slPrice) return "sl";
  }
  return null;
}

// ─── Settlement ────────────────────────────────────────────────────────────

/**
 * Settle at window expiry — close the position at the final price (linear P&L).
 */
export function settleExpiredPrediction(
  prediction: ActivePrediction,
  finalPrice: number
): { status: "won" | "lost"; pnl: number; exitPrice: number } {
  const pnl = calcLinearPnl(prediction.stake, prediction.entryPrice, finalPrice, prediction.direction);
  return { status: pnl > 0 ? "won" : "lost", pnl, exitPrice: finalPrice };
}

/**
 * Resolve an early TP or SL exit at the level price.
 */
export function resolveTrigger(
  prediction: ActivePrediction,
  trigger: "tp" | "sl"
): { status: "taken" | "stopped"; pnl: number; exitPrice: number } {
  const exitPrice = trigger === "tp" ? prediction.tpPrice : prediction.slPrice;
  const pnl = calcLinearPnl(prediction.stake, prediction.entryPrice, exitPrice, prediction.direction);
  return {
    status:   trigger === "tp" ? "taken" : "stopped",
    pnl,
    exitPrice,
  };
}

// ─── XP / levels ──────────────────────────────────────────────────────────

export function xpForWin(streak: number): number {
  return XP_PER_WIN + Math.min(streak, 10) * 5;
}

export function levelFromXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

export function streakMultiplier(streak: number): number {
  if (streak >= 10) return 1.5;
  if (streak >= 5)  return 1.25;
  if (streak >= 3)  return 1.1;
  return 1;
}
