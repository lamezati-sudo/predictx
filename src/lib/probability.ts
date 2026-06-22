/**
 * Probability model — lively & sensitive: the line dances with every small
 * price tick and never freezes pegged at the 0¢/100¢ rails.
 *
 * Formula:  z = K * delta * timeBoost,   P = clamp(sigmoid(z), 0.02, 0.98)
 *   delta     = (current − target) / target           (price gap, %)
 *   timeBoost = min(BOOST_MAX, 1 / timeRatio^0.22)     (gently sharper near expiry)
 *
 * Sensitivity (BTC ≈ $100k, window start, timeBoost = 1, K = 2200):
 *   • $5   up (0.005%) → z ≈ 0.11 → ~53¢   ← small ticks visibly move the line
 *   • $20  up (0.02%)  → z ≈ 0.44 → ~61¢
 *   • $50  up (0.05%)  → z ≈ 1.10 → ~75¢
 *   • $150 up (0.15%)  → z ≈ 3.30 → ~96¢
 *
 * The 2¢–98¢ clamp guarantees there is always headroom for the line to react,
 * so even a strong late lead keeps nudging instead of flatlining at the rail.
 * timeBoost is softened (0.22 exp) and capped (BOOST_MAX) so approaching expiry
 * sharpens the curve without slamming z into saturation.
 */
const K          = 2200;
const BOOST_MAX  = 2.2;
const PROB_FLOOR = 0.02;
const PROB_CEIL  = 0.98;

export function calcPAbove(
  currentPrice: number,
  targetPrice: number,
  msRemaining: number,
  totalWindowMs: number
): number {
  if (targetPrice <= 0 || currentPrice <= 0) return 0.5;
  const delta     = (currentPrice - targetPrice) / targetPrice;
  const timeRatio = Math.max(0.02, msRemaining / totalWindowMs);
  const timeBoost = Math.min(BOOST_MAX, 1 / Math.pow(timeRatio, 0.22));
  const z         = Math.max(-8, Math.min(8, K * delta * timeBoost));
  const p         = 1 / (1 + Math.exp(-z));
  return Math.max(PROB_FLOOR, Math.min(PROB_CEIL, p));
}

/** Probability that the user's chosen direction wins. */
export function calcDirectionProb(
  direction: "above" | "below",
  currentPrice: number,
  targetPrice: number,
  msRemaining: number,
  totalWindowMs: number
): number {
  const p = calcPAbove(currentPrice, targetPrice, msRemaining, totalWindowMs);
  return direction === "above" ? p : 1 - p;
}

/**
 * Default TP/SL levels span the full range (1¢ – 99¢).
 * Entry is set to the current probability.
 * Users drag them tighter if they want early exits.
 */
export function defaultProbLevels(entryProb: number): {
  entry:      number;
  takeProfit: number;
  stopLoss:   number;
} {
  return {
    entry:      entryProb,
    takeProfit: 0.99,
    stopLoss:   0.01,
  };
}

/**
 * Mark-to-market PnL (prediction market model):
 *   Bought at P, current value is exitProb per unit of stake.
 *   PnL = stake * (exitProb − entryProb) / entryProb
 */
export function calcPnl(
  stake: number,
  entryProb: number,
  exitProb: number
): number {
  if (entryProb <= 0) return 0;
  return stake * (exitProb - entryProb) / entryProb;
}
