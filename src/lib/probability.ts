/**
 * Probability model — Robinhood-style: stays in the lively middle range and
 * reacts to every tick, instead of pegging to 0¢/100¢ and freezing.
 *
 * Formula:  z = K * delta * timeBoost,   P = sigmoid(z)
 *   delta     = (current − target) / target           (price gap, %)
 *   timeBoost = 1 / timeRatio^0.35                      (sharper near expiry)
 *
 * Calibration (BTC ≈ $64k, window start, timeBoost = 1):
 *   • $500 up  (0.78%) → z ≈ 3.12 → ~96¢   ← matches user spec
 *   • $300 up  (0.47%) → z ≈ 1.87 → ~87¢
 *   • $100 up  (0.16%) → z ≈ 0.62 → ~65¢
 *   • $30  up  (0.05%) → z ≈ 0.19 → ~55¢   ← small ticks still move the line
 *
 * Because K is moderate (not 1200), a $200 lead does NOT instantly peg to
 * 100¢ — the line keeps fluctuating, which is what makes it tradeable.
 * timeBoost then sharpens the curve toward expiry (a lead late = more certain).
 */
const K = 400;

export function calcPAbove(
  currentPrice: number,
  targetPrice: number,
  msRemaining: number,
  totalWindowMs: number
): number {
  if (targetPrice <= 0 || currentPrice <= 0) return 0.5;
  const delta     = (currentPrice - targetPrice) / targetPrice;
  const timeRatio = Math.max(0.02, msRemaining / totalWindowMs);
  const timeBoost = 1 / Math.pow(timeRatio, 0.35);
  const z         = Math.max(-8, Math.min(8, K * delta * timeBoost));
  return 1 / (1 + Math.exp(-z));
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
