import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCurrentPrice } from "@/lib/server/prices";
import { calcLinearPnl } from "@/lib/probability";
import { type Direction } from "@/types";

/**
 * POST /api/predictions/exit — early exit (TP / SL / manual).
 * Body: { predictionId, reason: "tp" | "sl" | "manual" }
 *
 * The server re-fetches the live price and recomputes the probability, so a
 * TP/SL exit is only honored if the trigger is genuinely met. A "manual" exit
 * settles at the current (server-computed) probability.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { predictionId?: string; reason?: "tp" | "sl" | "manual" };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const { predictionId, reason = "manual" } = body;
  if (!predictionId) return NextResponse.json({ error: "predictionId required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: pred } = await admin
    .from("predictions").select("*").eq("id", predictionId).maybeSingle();
  if (!pred)                     return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pred.user_id !== user.id)  return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (pred.status !== "active")  return NextResponse.json({ error: "already settled" }, { status: 409 });

  let price: number;
  try { price = await fetchCurrentPrice(pred.asset); }
  catch { return NextResponse.json({ error: "price unavailable" }, { status: 502 }); }

  const direction = pred.direction as Direction;
  const entry  = Number(pred.entry_price);
  const tp     = Number(pred.tp_price);
  const sl     = Number(pred.sl_price);
  // Small tolerance (~0.02%) so a momentary touch still honors the trigger.
  const tol = entry * 0.0002;

  // Validate the trigger condition server-side, then settle at the level price.
  let exitPrice = price;
  let status: "taken" | "stopped";
  if (reason === "tp") {
    const reached = direction === "above" ? price >= tp - tol : price <= tp + tol;
    if (!reached) return NextResponse.json({ error: "TP not reached" }, { status: 409 });
    exitPrice = tp;
    status = "taken";
  } else if (reason === "sl") {
    const reached = direction === "above" ? price <= sl + tol : price >= sl - tol;
    if (!reached) return NextResponse.json({ error: "SL not reached" }, { status: 409 });
    exitPrice = sl;
    status = "stopped";
  } else {
    // manual close at the live price
    const pnlNow = calcLinearPnl(Number(pred.stake), entry, price, direction);
    status = pnlNow >= 0 ? "taken" : "stopped";
  }

  const pnl = calcLinearPnl(Number(pred.stake), entry, exitPrice, direction);

  const { error } = await admin.rpc("settle_prediction", {
    p_prediction_id: predictionId,
    p_status:        status,
    p_pnl:           round2(pnl),
    p_exit_price:    round8(exitPrice),
    p_exit_prob:     null,
    p_exit_reason:   reason === "manual" ? "manual" : reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status, pnl: round2(pnl), exitPrice });
}

function round2(v: number) { return Math.round(v * 100) / 100; }
function round8(v: number) { return Math.round(v * 1e8) / 1e8; }
