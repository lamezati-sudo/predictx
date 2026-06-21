import type { ActivePrediction } from "@/types";
import { calcPnl } from "@/lib/probability";

const XP_PER_WIN   = 25;
const XP_PER_LEVEL = 400;

// ─── Trigger checks ────────────────────────────────────────────────────────

/**
 * Check if the current direction probability has crossed a TP or SL threshold.
 * dirProb = P(user's direction wins right now).
 */
export function checkPredictionTriggers(
  prediction: ActivePrediction,
  dirProb: number
): "tp" | "sl" | null {
  if (prediction.status !== "active") return null;
  if (dirProb >= prediction.tpProb) return "tp";
  if (dirProb <= prediction.slProb) return "sl";
  return null;
}

// ─── Settlement ────────────────────────────────────────────────────────────

/**
 * Settle at window expiry.
 * finalPrice vs targetPrice determines win/loss.
 * Payout is based on entry probability (prediction market model).
 */
export function settleExpiredPrediction(
  prediction: ActivePrediction,
  finalPrice: number
): { status: "won" | "lost"; pnl: number; exitProb: number } {
  const won = prediction.direction === "above"
    ? finalPrice > prediction.targetPrice
    : finalPrice < prediction.targetPrice;

  const exitProb = won ? 0.98 : 0.02;
  const pnl      = calcPnl(prediction.stake, prediction.entryProb, exitProb);

  return { status: won ? "won" : "lost", pnl, exitProb };
}

/**
 * Resolve an early TP or SL exit.
 * Exit probability: for TP use tpProb, for SL use slProb.
 */
export function resolveTrigger(
  prediction: ActivePrediction,
  trigger: "tp" | "sl"
): { status: "taken" | "stopped"; pnl: number; exitProb: number } {
  const exitProb = trigger === "tp" ? prediction.tpProb : prediction.slProb;
  const pnl      = calcPnl(prediction.stake, prediction.entryProb, exitProb);
  return {
    status:   trigger === "tp" ? "taken" : "stopped",
    pnl,
    exitProb,
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
