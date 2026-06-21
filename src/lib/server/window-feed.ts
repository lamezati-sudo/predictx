import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcPAbove } from "@/lib/probability";
import { assetSymbol, TIMEFRAME_MS, type Asset, type Timeframe } from "@/types";
import { fetchCurrentPrice } from "@/lib/server/prices";

const KLINE_HOSTS = [
  "https://api.binance.us/api/v3",
  "https://api.binance.com/api/v3",
];

async function binanceKlines(
  symbol: string,
  interval: string,
  limit: number,
  startTime?: number
): Promise<unknown[][]> {
  const qs = `symbol=${symbol}&interval=${interval}&limit=${limit}${startTime ? `&startTime=${startTime}` : ""}`;
  for (const host of KLINE_HOSTS) {
    try {
      const res = await fetch(`${host}/klines?${qs}`, { cache: "no-store" });
      if (res.ok) return (await res.json()) as unknown[][];
    } catch {
      // try next
    }
  }
  throw new Error("klines unavailable");
}

export interface ProbTickRow {
  time_sec:   number;
  prob_above: number;
  spot_price: number;
}

export interface WindowRow {
  id:           string;
  asset:        string;
  timeframe:    string;
  window_start: string;
  window_end:   string;
  target_price: number;
}

function probAtPrice(
  spot: number,
  target: number,
  windowEndMs: number,
  totalMs: number,
  atMs: number
): number {
  const msRemaining = Math.max(0, windowEndMs - atMs);
  return calcPAbove(spot, target, msRemaining, totalMs);
}

/** Fetch all persisted ticks for a window, oldest first. */
export async function fetchWindowTicks(windowId: string): Promise<ProbTickRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("window_prob_ticks")
    .select("time_sec, prob_above, spot_price")
    .eq("window_id", windowId)
    .order("time_sec", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    time_sec:   Number(r.time_sec),
    prob_above: Number(r.prob_above),
    spot_price: Number(r.spot_price),
  }));
}

/** Upsert one canonical tick (idempotent — safe if many clients sample). */
export async function upsertWindowTick(
  windowId: string,
  timeSec: number,
  probAbove: number,
  spotPrice: number
): Promise<ProbTickRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("window_prob_ticks")
    .upsert(
      {
        window_id:  windowId,
        time_sec:   timeSec,
        prob_above: Math.round(probAbove * 1e5) / 1e5,
        spot_price: spotPrice,
      },
      { onConflict: "window_id,time_sec" }
    )
    .select("time_sec, prob_above, spot_price")
    .single();
  if (error) throw new Error(error.message);
  return {
    time_sec:   Number(data.time_sec),
    prob_above: Number(data.prob_above),
    spot_price: Number(data.spot_price),
  };
}

/**
 * Sample live price, compute prob_above, persist. Called ~1 Hz from any client.
 */
export async function sampleLiveTick(win: WindowRow): Promise<ProbTickRow | null> {
  const endMs   = new Date(win.window_end).getTime();
  const now     = Date.now();
  if (now >= endMs) return null;

  const asset   = win.asset as Asset;
  const tf      = win.timeframe as Timeframe;
  const target  = Number(win.target_price);
  const totalMs = TIMEFRAME_MS[tf];
  const spot    = await fetchCurrentPrice(asset);
  const timeSec = Math.floor(now / 1000);
  const prob    = probAtPrice(spot, target, endMs, totalMs, now);

  return upsertWindowTick(win.id, timeSec, prob, spot);
}

/**
 * Backfill 1m-candle prob points from window start → now (or window end).
 * Runs when a window has few/no ticks so refresh never shows an empty chart.
 */
export async function backfillWindowTicks(win: WindowRow): Promise<number> {
  const admin     = createAdminClient();
  const asset     = win.asset as Asset;
  const tf        = win.timeframe as Timeframe;
  const target    = Number(win.target_price);
  const startMs   = new Date(win.window_start).getTime();
  const endMs     = new Date(win.window_end).getTime();
  const totalMs   = TIMEFRAME_MS[tf];
  const nowMs     = Math.min(Date.now(), endMs);
  const maxCandles = Math.ceil((nowMs - startMs) / 60_000) + 1;

  if (maxCandles <= 0) return 0;

  const symbol = assetSymbol(asset);
  const klines = await binanceKlines(symbol, "1m", Math.min(maxCandles, 120), startMs);

  const rows = klines.map((k) => {
    const candleMs = k[0] as number;
    const close    = parseFloat(k[4] as string);
    const timeSec  = Math.floor(candleMs / 1000);
    const prob     = probAtPrice(close, target, endMs, totalMs, candleMs);
    return {
      window_id:  win.id,
      time_sec:   timeSec,
      prob_above: Math.round(prob * 1e5) / 1e5,
      spot_price: close,
    };
  });

  if (rows.length === 0) return 0;

  const { error } = await admin
    .from("window_prob_ticks")
    .upsert(rows, { onConflict: "window_id,time_sec" });
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Backfill if sparse, then return full tick series. */
export async function ensureWindowTicks(win: WindowRow): Promise<ProbTickRow[]> {
  let ticks = await fetchWindowTicks(win.id);
  // Fewer than ~2 minutes of data → backfill from candles
  if (ticks.length < 2) {
    await backfillWindowTicks(win);
    ticks = await fetchWindowTicks(win.id);
  }
  return ticks;
}
