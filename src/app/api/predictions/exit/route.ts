import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCurrentPrice } from "@/lib/server/prices";
import { calcDirectionProb, calcPnl } from "@/lib/probability";
import { TIMEFRAME_MS, type Direction, type Timeframe } from "@/types";

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

  const totalMs = TIMEFRAME_MS[pred.timeframe as Timeframe];
  const endMs   = new Date(pred.expires_at).getTime();
  const msLeft  = Math.max(0, endMs - Date.now());
  const dirProb = calcDirectionProb(
    pred.direction as Direction, price, Number(pred.target_price), msLeft, totalMs
  );

  // Validate the trigger condition server-side
  let exitProb = dirProb;
  let status: "taken" | "stopped";
  if (reason === "tp") {
    if (dirProb < Number(pred.tp_prob) - 0.008)
      return NextResponse.json({ error: "TP not reached" }, { status: 409 });
    exitProb = Math.max(Number(pred.tp_prob), dirProb);
    status = "taken";
  } else if (reason === "sl") {
    if (dirProb > Number(pred.sl_prob) + 0.008)
      return NextResponse.json({ error: "SL not reached" }, { status: 409 });
    exitProb = Math.min(Number(pred.sl_prob), dirProb);
    status = "stopped";
  } else {
    // manual close at current probability
    status = dirProb >= Number(pred.entry_prob) ? "taken" : "stopped";
  }

  const pnl = calcPnl(Number(pred.stake), Number(pred.entry_prob), exitProb);

  const { error } = await admin.rpc("settle_prediction", {
    p_prediction_id: predictionId,
    p_status:        status,
    p_pnl:           round2(pnl),
    p_exit_price:    price,
    p_exit_prob:     round5(exitProb),
    p_exit_reason:   reason === "manual" ? "manual" : reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status, pnl: round2(pnl), exitProb });
}

function round2(v: number) { return Math.round(v * 100) / 100; }
function round5(v: number) { return Math.round(v * 1e5) / 1e5; }
