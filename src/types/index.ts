export type Asset = "BTC" | "ETH" | "SOL";
export type Timeframe = "15m" | "1h" | "2h";
export type Direction = "above" | "below";
export type PredictionStatus = "active" | "won" | "lost" | "stopped" | "taken";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Probability-based levels (all values 0–1). */
export interface ProbLevels {
  entry:      number; // probability of direction at the moment levels were set
  takeProfit: number; // exit when directionProb ≥ this
  stopLoss:   number; // exit when directionProb ≤ this
}

export interface ActivePrediction {
  id:         string;
  asset:      Asset;
  timeframe:  Timeframe;
  direction:  Direction;
  entryPrice: number;
  targetPrice: number;
  entryProb:  number;  // 0–1
  tpProb:     number;  // 0–1 — exit when directionProb ≥ this
  slProb:     number;  // 0–1 — exit when directionProb ≤ this
  tpQty:      number;  // 1–100 % of stake to close at TP
  slQty:      number;  // 1–100 % of stake to close at SL
  stake:      number;
  openedAt:   number;  // epoch ms
  expiresAt:  number;  // epoch ms of window end
  status:     PredictionStatus;
  pnl?:       number;
  exitPrice?: number;
  exitProb?:  number;
  exitReason?: "tp" | "sl" | "expiry";
}

export const ASSETS: { id: Asset; symbol: string; name: string; color: string }[] = [
  { id: "BTC", symbol: "BTCUSDT", name: "Bitcoin",  color: "#f7931a" },
  { id: "ETH", symbol: "ETHUSDT", name: "Ethereum", color: "#627eea" },
  { id: "SOL", symbol: "SOLUSDT", name: "Solana",   color: "#9945ff" },
];

export const TIMEFRAMES: { id: Timeframe; label: string; minutes: number }[] = [
  { id: "15m", label: "15 min", minutes: 15 },
  { id: "1h",  label: "1 hour", minutes: 60 },
  { id: "2h",  label: "2 hours", minutes: 120 },
];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "15m": 15 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "2h": 120 * 60 * 1000,
};

export function assetSymbol(asset: Asset): string {
  return ASSETS.find((a) => a.id === asset)?.symbol ?? "BTCUSDT";
}

export function formatPrice(price: number, _asset?: Asset): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUsd(amount: number): string {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
