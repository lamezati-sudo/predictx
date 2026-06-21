import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCurrentPrice } from "@/lib/server/prices";
import { calcDirectionProb } from "@/lib/probability";
import { TIMEFRAME_MS, type Direction, type Timeframe } from "@/types";

/** GET /api/predictions — the caller's predictions (active + recent history). */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("predictions")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ predictions: data });
}

/**
 * POST /api/predictions — place a bet.
 * Body: { windowId, direction, stake, tpProb, slProb, tpQty, slQty }
 * The server fixes entry price + entry probability and debits the balance
 * atomically via the place_prediction RPC.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    windowId?: string; direction?: Direction; stake?: number;
    tpProb?: number; slProb?: number; tpQty?: number; slQty?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const { windowId, direction, stake, tpProb, slProb, tpQty, slQty } = body;
  if (!windowId || (direction !== "above" && direction !== "below") ||
      typeof stake !== "number" || stake <= 0) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load the window (authoritative target + expiry)
  const { data: win } = await admin
    .from("windows").select("*").eq("id", windowId).maybeSingle();
  if (!win)             return NextResponse.json({ error: "window not found" }, { status: 404 });
  if (win.status !== "open")
    return NextResponse.json({ error: "window closed" }, { status: 409 });

  const endMs = new Date(win.window_end).getTime();
  if (Date.now() >= endMs)
    return NextResponse.json({ error: "window expired" }, { status: 409 });

  // Fix entry price + probability on the server
  let price: number;
  try { price = await fetchCurrentPrice(win.asset); }
  catch { return NextResponse.json({ error: "price unavailable" }, { status: 502 }); }

  const totalMs   = TIMEFRAME_MS[win.timeframe as Timeframe];
  const msLeft    = Math.max(0, endMs - Date.now());
  const entryProb = calcDirectionProb(direction, price, Number(win.target_price), msLeft, totalMs);

  const tp = clampProb(tpProb ?? 0.99);
  const sl = clampProb(slProb ?? 0.01);
  if (!(tp > entryProb && sl < entryProb)) {
    return NextResponse.json(
      { error: "TP must be above and SL below the current probability" },
      { status: 400 }
    );
  }

  const { data: pred, error } = await admin.rpc("place_prediction", {
    p_user_id:      user.id,
    p_window_id:    windowId,
    p_asset:        win.asset,
    p_timeframe:    win.timeframe,
    p_direction:    direction,
    p_entry_price:  price,
    p_target_price: Number(win.target_price),
    p_entry_prob:   round5(entryProb),
    p_tp_prob:      round5(tp),
    p_sl_prob:      round5(sl),
    p_tp_qty:       clampQty(tpQty ?? 100),
    p_sl_qty:       clampQty(slQty ?? 100),
    p_stake:        stake,
    p_expires_at:   win.window_end,
  });

  if (error) {
    const status = error.message.includes("insufficient") ? 402 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ prediction: pred });
}

function clampProb(v: number) { return Math.max(0.01, Math.min(0.99, v)); }
function clampQty(v: number)  { return Math.max(1, Math.min(100, Math.round(v))); }
function round5(v: number)    { return Math.round(v * 1e5) / 1e5; }
