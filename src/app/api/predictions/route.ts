import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCurrentPrice } from "@/lib/server/prices";
import { type Direction } from "@/types";

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
 * Body: { windowId, direction, stake, tpPrice, slPrice, tpQty, slQty }
 * The server fixes entry price + entry probability and debits the balance
 * atomically via the place_prediction RPC.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    windowId?: string; direction?: Direction; stake?: number;
    tpPrice?: number; slPrice?: number; tpQty?: number; slQty?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const { windowId, direction, stake, tpPrice, slPrice, tpQty, slQty } = body;
  if (!windowId || (direction !== "above" && direction !== "below") ||
      typeof stake !== "number" || stake <= 0 ||
      typeof tpPrice !== "number" || typeof slPrice !== "number") {
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

  // Fix the entry price on the server (authoritative)
  let price: number;
  try { price = await fetchCurrentPrice(win.asset); }
  catch { return NextResponse.json({ error: "price unavailable" }, { status: 502 }); }

  // Validate TP/SL price placement relative to entry & direction.
  // UP: TP ≥ entry, SL ≤ entry.  DOWN: TP ≤ entry, SL ≥ entry. (TP = entry → $0)
  const valid = direction === "above"
    ? tpPrice >= price && slPrice <= price
    : tpPrice <= price && slPrice >= price;
  if (!valid) {
    return NextResponse.json(
      { error: "TP/SL on the wrong side of the entry price" },
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
    p_tp_price:     round8(tpPrice),
    p_sl_price:     round8(slPrice),
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

function clampQty(v: number)  { return Math.max(1, Math.min(100, Math.round(v))); }
function round8(v: number)    { return Math.round(v * 1e8) / 1e8; }
