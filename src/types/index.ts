export type Asset = "BTC" | "ETH" | "SOL";
export type Timeframe = "5m" | "15m" | "1h" | "1d";
export type Direction = "above" | "below";
export type PredictionStatus = "active" | "won" | "lost" | "stopped" | "taken";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Price-based levels (all values are USD prices on the asset). */
export interface PriceLevels {
  entry:      number; // asset price at the moment the position was opened
  takeProfit: number; // exit when price reaches this (above entry for UP, below for DOWN)
  stopLoss:   number; // exit when price reaches this (below entry for UP, above for DOWN)
}

export interface ActivePrediction {
  id:         string;
  asset:      Asset;
  timeframe:  Timeframe;
  direction:  Direction;
  entryPrice: number;
  targetPrice: number;
  tpPrice:    number;  // USD price — exit at profit
  slPrice:    number;  // USD price — exit at loss
  tpQty:      number;  // 1–100 % of stake to close at TP
  slQty:      number;  // 1–100 % of stake to close at SL
  stake:      number;
  openedAt:   number;  // epoch ms
  expiresAt:  number;  // epoch ms of window end
  status:     PredictionStatus;
  pnl?:       number;
  exitPrice?: number;
  exitReason?: "tp" | "sl" | "expiry";
}

export const ASSETS: { id: Asset; symbol: string; name: string; color: string }[] = [
  { id: "BTC", symbol: "BTCUSDT", name: "Bitcoin",  color: "#f7931a" },
  { id: "ETH", symbol: "ETHUSDT", name: "Ethereum", color: "#627eea" },
  { id: "SOL", symbol: "SOLUSDT", name: "Solana",   color: "#9945ff" },
];

export const TIMEFRAMES: { id: Timeframe; label: string; minutes: number }[] = [
  { id: "5m",  label: "5 min",  minutes: 5 },
  { id: "15m", label: "15 min", minutes: 15 },
  { id: "1h",  label: "1 hour", minutes: 60 },
  { id: "1d",  label: "1 day",  minutes: 1440 },
];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m":   5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "1d": 1440 * 60 * 1000,
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
