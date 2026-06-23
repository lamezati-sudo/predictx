import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTargetPrice, windowBounds } from "@/lib/server/prices";
import { ensureWindowTicks, type WindowRow } from "@/lib/server/window-feed";
import type { Asset, Timeframe } from "@/types";

const ASSETS: Asset[] = ["BTC", "ETH", "SOL"];
const TFS: Timeframe[] = ["5m", "15m", "1h", "1d"];

/**
 * GET /api/window?asset=BTC&timeframe=15m
 * Returns the current window + full persisted probability tick history.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const asset     = searchParams.get("asset") as Asset;
  const timeframe = searchParams.get("timeframe") as Timeframe;
  if (!ASSETS.includes(asset) || !TFS.includes(timeframe)) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  const { start, end } = windowBounds(timeframe);
  const windowStartISO = new Date(start).toISOString();
  const admin = createAdminClient();

  let win = (await admin
    .from("windows")
    .select("*")
    .eq("asset", asset)
    .eq("timeframe", timeframe)
    .eq("window_start", windowStartISO)
    .maybeSingle()).data;

  if (!win) {
    let target: number;
    try {
      target = await fetchTargetPrice(asset, timeframe);
    } catch {
      return NextResponse.json({ error: "price source unavailable" }, { status: 502 });
    }

    const { data: created, error } = await admin
      .from("windows")
      .upsert(
        {
          asset,
          timeframe,
          window_start: windowStartISO,
          window_end:   new Date(end).toISOString(),
          target_price: target,
          status:       "open",
        },
        { onConflict: "asset,timeframe,window_start" }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    win = created;
  }

  const row = win as WindowRow;
  let ticks;
  try {
    ticks = await ensureWindowTicks(row);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  return NextResponse.json({ window: win, ticks });
}
