import "server-only";
import { assetSymbol, TIMEFRAME_MS, type Asset, type Timeframe } from "@/types";

const KLINE_HOSTS = [
  "https://api.binance.us/api/v3",
  "https://api.binance.com/api/v3",
];

async function binanceFetch(pathAndQuery: string): Promise<unknown> {
  for (const host of KLINE_HOSTS) {
    try {
      const res = await fetch(`${host}${pathAndQuery}`, { cache: "no-store" });
      if (res.ok) return res.json();
    } catch {
      // try next host
    }
  }
  throw new Error("All Binance endpoints failed");
}

/** Wall-clock window boundaries (epoch ms), identical math to the client. */
export function windowBounds(tf: Timeframe, at = Date.now()) {
  const ms = TIMEFRAME_MS[tf];
  const start = Math.floor(at / ms) * ms;
  return { start, end: start + ms, ms };
}

/**
 * Target price = close of the candle that ended exactly at `windowStart`.
 * We request the two most recent `tf` candles; index 0 is the last completed
 * one (which closed at the current window's start).
 */
export async function fetchTargetPrice(asset: Asset, tf: Timeframe): Promise<number> {
  const symbol = assetSymbol(asset);
  const data = (await binanceFetch(
    `/klines?symbol=${symbol}&interval=${tf === "15m" ? "15m" : tf === "1h" ? "1h" : "2h"}&limit=2`
  )) as unknown[][];
  return parseFloat(data[0][4] as string);
}

/** Latest trade price for an asset. */
export async function fetchCurrentPrice(asset: Asset): Promise<number> {
  const symbol = assetSymbol(asset);
  const data = (await binanceFetch(`/ticker/price?symbol=${symbol}`)) as { price: string };
  return parseFloat(data.price);
}

/**
 * Close price of a window that has already ended — i.e. the close of the 1m
 * candle whose close timestamp is `windowEnd`. Used for settlement.
 */
export async function fetchCloseAt(asset: Asset, windowEndMs: number): Promise<number> {
  const symbol = assetSymbol(asset);
  // Grab the 1m candle that ends at windowEnd (starts at windowEnd - 60s)
  const startTime = windowEndMs - 60_000;
  const data = (await binanceFetch(
    `/klines?symbol=${symbol}&interval=1m&startTime=${startTime}&limit=1`
  )) as unknown[][];
  if (data.length > 0) return parseFloat(data[0][4] as string);
  // Fallback: current price if the historical candle isn't available yet
  return fetchCurrentPrice(asset);
}
