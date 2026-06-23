/**
 * PredictX market worker — ONE process samples prices and broadcasts to all users.
 *
 * Run alongside the Next.js app:
 *   npm run worker
 *
 * - Binance WebSocket → live spot prices (BTC, ETH, SOL)
 * - Computes canonical P(above) per open window
 * - Realtime Broadcast → all browsers (no DB, no auth per tick)
 * - Batch DB upsert every 15s → graph survives refresh
 */

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { calcPAbove } from "../src/lib/probability";
import { TIMEFRAME_MS, type Asset, type Timeframe } from "../src/types";

// ── Config ───────────────────────────────────────────────────────────────────
const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h", "1d"];
const SYMBOL: Record<Asset, string> = { BTC: "btcusdt", ETH: "ethusdt", SOL: "solusdt" };
const BROADCAST_MS = 1000;  // live push rate (WebSocket — not REST)
const FLUSH_MS     = 15000; // DB snapshot interval

// ── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const SITE_URL     = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── State ────────────────────────────────────────────────────────────────────
const prices: Record<Asset, number> = { BTC: 0, ETH: 0, SOL: 0 };
interface WinState {
  id: string;
  asset: Asset;
  timeframe: Timeframe;
  target: number;
  endMs: number;
  channel: RealtimeChannel;
}
const windows = new Map<string, WinState>(); // key: `${asset}:${tf}`
const pending = new Map<string, { window_id: string; time_sec: number; prob_above: number; spot_price: number }>();

// ── Wall-clock helpers ───────────────────────────────────────────────────────
function windowStart(tf: Timeframe, at = Date.now()) {
  const ms = TIMEFRAME_MS[tf];
  return Math.floor(at / ms) * ms;
}
function windowEnd(tf: Timeframe, at = Date.now()) {
  return windowStart(tf, at) + TIMEFRAME_MS[tf];
}

// ── Binance REST (target price + fallback spot) ──────────────────────────────
const KLINE_HOSTS = [
  "https://api.binance.us/api/v3",
  "https://api.binance.com/api/v3",
];

async function binanceGet(path: string): Promise<unknown> {
  for (const host of KLINE_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`, { cache: "no-store" });
      if (res.ok) return res.json();
    } catch { /* next */ }
  }
  throw new Error(`Binance fetch failed: ${path}`);
}

async function fetchTarget(asset: Asset, tf: Timeframe): Promise<number> {
  const sym = SYMBOL[asset].toUpperCase();
  // tf ("5m" | "15m" | "1h" | "1d") maps directly to a Binance interval.
  const data = (await binanceGet(`/klines?symbol=${sym}&interval=${tf}&limit=2`)) as unknown[][];
  return parseFloat(data[0][4] as string);
}

// ── Window lifecycle ─────────────────────────────────────────────────────────
async function channelFor(windowId: string): Promise<RealtimeChannel> {
  const ch = supabase.channel(`prob:${windowId}`, {
    config: { broadcast: { ack: false, self: false } },
  });
  await new Promise<void>((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
    });
  });
  return ch;
}

async function syncWindows() {
  const now = Date.now();

  for (const asset of ASSETS) {
    for (const tf of TIMEFRAMES) {
      const key    = `${asset}:${tf}`;
      const start  = windowStart(tf, now);
      const end    = windowEnd(tf, now);
      const startISO = new Date(start).toISOString();

      // Drop stale window (wall-clock rolled)
      const existing = windows.get(key);
      if (existing && existing.endMs <= now) {
        await supabase.removeChannel(existing.channel);
        windows.delete(key);
      }

      if (windows.has(key)) continue;

      // Ensure row in DB
      let row = (await supabase
        .from("windows")
        .select("*")
        .eq("asset", asset)
        .eq("timeframe", tf)
        .eq("window_start", startISO)
        .maybeSingle()).data;

      if (!row) {
        const target = await fetchTarget(asset, tf);
        const { data: created } = await supabase
          .from("windows")
          .upsert({
            asset,
            timeframe:    tf,
            window_start: startISO,
            window_end:   new Date(end).toISOString(),
            target_price: target,
            status:       "open",
          }, { onConflict: "asset,timeframe,window_start" })
          .select()
          .single();
        row = created;
      }
      if (!row) continue;

      const ch = await channelFor(row.id as string);
      windows.set(key, {
        id:        row.id as string,
        asset,
        timeframe: tf,
        target:    Number(row.target_price),
        endMs:     end,
        channel:   ch,
      });
      console.log(`[window] ${asset} ${tf} → ${row.id} target=$${Number(row.target_price).toFixed(2)}`);
    }
  }
}

// ── Binance WebSocket (combined aggTrade stream) ─────────────────────────────
function connectPrices() {
  const streams = ASSETS.map((a) => `${SYMBOL[a]}@aggTrade`).join("/");
  const bases = [
    "wss://stream.binance.us:9443",
    "wss://stream.binance.com:9443",
  ];
  let hostIdx = 0;

  function connect() {
    const url = `${bases[hostIdx % bases.length]}/stream?streams=${streams}`;
    const ws = new WebSocket(url);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { stream: string; data: { p: string } };
        const sym = msg.stream.split("@")[0].toUpperCase();
        const asset = ASSETS.find((a) => SYMBOL[a].toUpperCase() === sym);
        if (asset) prices[asset] = parseFloat(msg.data.p);
      } catch { /* ignore */ }
    };
    ws.onclose = () => { hostIdx++; setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
  }
  connect();
}

// ── Broadcast + queue DB snapshot ────────────────────────────────────────────
function probAt(spot: number, target: number, endMs: number, tf: Timeframe, atMs: number) {
  const msRemaining = Math.max(0, endMs - atMs);
  return calcPAbove(spot, target, msRemaining, TIMEFRAME_MS[tf]);
}

function broadcastAll() {
  const now = Date.now();
  const timeSec = Math.floor(now / 1000);

  for (const w of windows.values()) {
    if (now >= w.endMs) continue;
    const spot = prices[w.asset];
    if (spot <= 0) continue;

    const prob = probAt(spot, w.target, w.endMs, w.timeframe, now);
    const payload = {
      time_sec:   timeSec,
      prob_above: Math.round(prob * 1e5) / 1e5,
      spot_price: spot,
    };

    // Push to all connected browsers (zero DB / zero auth)
    w.channel.send({ type: "broadcast", event: "tick", payload });

    const dedupeKey = `${w.id}:${timeSec}`;
    pending.set(dedupeKey, { window_id: w.id, ...payload });
  }
}

async function flushDb() {
  if (pending.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  const { error } = await supabase
    .from("window_prob_ticks")
    .upsert(rows, { onConflict: "window_id,time_sec" });
  if (error) console.error("[flush]", error.message);
  else console.log(`[flush] ${rows.length} ticks persisted`);
}

/** Hobby Vercel can't run * * * * * crons — worker pings settle every 60s instead. */
async function runSettlement() {
  if (!CRON_SECRET || !SITE_URL) return;
  try {
    const base = SITE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/api/cron/settle`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[settle]", res.status, await res.text());
      return;
    }
    const body = (await res.json()) as { windowsSettled?: number; predictionsSettled?: number };
    if ((body.windowsSettled ?? 0) > 0 || (body.predictionsSettled ?? 0) > 0) {
      console.log("[settle]", body);
    }
  } catch (e) {
    console.error("[settle]", e);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("PredictX market worker starting…");
  connectPrices();
  await syncWindows();

  setInterval(broadcastAll, BROADCAST_MS);
  setInterval(flushDb, FLUSH_MS);
  setInterval(syncWindows, 30000); // pick up new wall-clock windows
  setInterval(runSettlement, 60_000);

  if (CRON_SECRET && SITE_URL) {
    console.log(`Settlement ping → ${SITE_URL}/api/cron/settle every 60s`);
    void runSettlement();
  } else {
    console.warn("CRON_SECRET or SITE_URL missing — expiry settlement disabled");
  }

  console.log(`Broadcast ${1000 / BROADCAST_MS} Hz · DB flush every ${FLUSH_MS / 1000}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
