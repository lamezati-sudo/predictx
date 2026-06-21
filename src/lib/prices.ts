import type { Asset, Candle, Timeframe } from "@/types";
import { assetSymbol, TIMEFRAME_MS } from "@/types";

// Base URLs (without /ws suffix — we use /stream for combined streams)
const BINANCE_WS_BASES = [
  "wss://stream.binance.us:9443",
  "wss://stream.binance.com:9443",
];

// ─── Wall-clock window helpers ──────────────────────────────────────────────
// Windows are always aligned to wall clock:
//   15m → :00 :15 :30 :45
//   1h  → :00 each hour
//   2h  → :00 :02 :04 …

export function getWindowStart(tf: Timeframe): number {
  const ms = TIMEFRAME_MS[tf];
  return Math.floor(Date.now() / ms) * ms;
}

export function getWindowEnd(tf: Timeframe): number {
  return getWindowStart(tf) + TIMEFRAME_MS[tf];
}

export function msToWindowEnd(tf: Timeframe): number {
  return Math.max(0, getWindowEnd(tf) - Date.now());
}

// ─── Klines fetch (shared) ───────────────────────────────────────────────────
async function klinesFetch(
  symbol: string,
  interval: string,
  limit: number,
  startTime?: number
): Promise<unknown[][]> {
  const url = `/api/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${startTime ? `&startTime=${startTime}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`klines ${res.status}`);
  return res.json() as Promise<unknown[][]>;
}

function parseCandles(data: unknown[][]): Candle[] {
  return data.map((k) => ({
    time:  Math.floor((k[0] as number) / 1000),
    open:  parseFloat(k[1] as string),
    high:  parseFloat(k[2] as string),
    low:   parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
  }));
}

// ─── Current window candles ──────────────────────────────────────────────────
// Fetches 1-min candles starting from the current wall-clock window boundary.
// For 15m: at most 15 candles; 1h: 60; 2h: 120.
export async function fetchWindowCandles(asset: Asset, tf: Timeframe): Promise<Candle[]> {
  const windowStart = getWindowStart(tf);
  const maxCandles  = TIMEFRAME_MS[tf] / 60_000; // window duration in minutes
  const symbol      = assetSymbol(asset);
  const data        = await klinesFetch(symbol, "1m", maxCandles, windowStart);
  return parseCandles(data);
}

// ─── Target price (close of the last COMPLETED window candle) ────────────────
export async function fetchTargetPrice(asset: Asset, tf: Timeframe): Promise<number> {
  const symbol = assetSymbol(asset);
  // limit=2 → data[0]=last completed candle, data[1]=currently forming
  const data = await klinesFetch(symbol, tf, 2);
  return parseFloat(data[0][4] as string);
}

// ─── Historical candles (for context, not used in window view) ───────────────
export async function fetchHistoricalCandles(
  asset: Asset,
  interval = "1m",
  limit    = 200
): Promise<Candle[]> {
  const symbol = assetSymbol(asset);
  return parseCandles(await klinesFetch(symbol, interval, limit));
}

// ─── WebSocket price stream ──────────────────────────────────────────────────
// Uses a combined stream:
//   @aggTrade  → fires on every trade (dozens/sec for BTC) — for live price
//   @kline_1m  → fires on every trade with candle structure — for chart candles
export function createPriceStream(
  asset: Asset,
  onCandle: (candle: Candle) => void,
  onPrice:  (price: number) => void
): () => void {
  const symbol   = assetSymbol(asset).toLowerCase();
  let ws: WebSocket | null = null;
  let cancelled  = false;
  let hostIdx    = 0;

  function connect() {
    if (cancelled) return;
    const base = BINANCE_WS_BASES[hostIdx % BINANCE_WS_BASES.length];
    // Combined stream URL: delivers both aggTrade and kline messages in one socket
    const url  = `${base}/stream?streams=${symbol}@aggTrade/${symbol}@kline_1m`;

    ws = new WebSocket(url);

    const failTimer = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        ws.close();
        hostIdx++;
        connect();
      }
    }, 5000);

    ws.onopen  = () => clearTimeout(failTimer);
    ws.onerror = () => { clearTimeout(failTimer); hostIdx++; connect(); };
    ws.onclose = (e) => {
      clearTimeout(failTimer);
      if (!cancelled && e.code !== 1000) { hostIdx++; connect(); }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as {
        stream: string;
        data: Record<string, unknown>;
      };

      if (msg.stream.endsWith("@aggTrade")) {
        // Real-time trade — p = price string
        onPrice(parseFloat(msg.data.p as string));

      } else if (msg.stream.endsWith("@kline_1m")) {
        const k = msg.data.k as Record<string, unknown>;
        if (!k) return;
        onCandle({
          time:  Math.floor((k.t as number) / 1000),
          open:  parseFloat(k.o as string),
          high:  parseFloat(k.h as string),
          low:   parseFloat(k.l as string),
          close: parseFloat(k.c as string),
        });
      }
    };
  }

  connect();
  return () => {
    cancelled = true;
    if (ws && ws.readyState < 2) ws.close();
  };
}

// ─── Default TP/SL relative to target ────────────────────────────────────────
export function defaultLevels(
  currentPrice: number,
  targetPrice:  number,
  direction:    "above" | "below"
): { entry: number; stopLoss: number; takeProfit: number } {
  const gap = targetPrice * 0.004;
  if (direction === "above") {
    return {
      entry:      currentPrice,
      takeProfit: targetPrice + gap * 1.5,
      stopLoss:   targetPrice - gap,
    };
  }
  return {
    entry:      currentPrice,
    takeProfit: targetPrice - gap * 1.5,
    stopLoss:   targetPrice + gap,
  };
}
