import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PATCH /api/predictions/levels
 * Update TP/SL (and optional qty) on an active prediction — e.g. after dragging on chart.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    predictionId?: string;
    tpPrice?: number;
    slPrice?: number;
    tpQty?: number;
    slQty?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const { predictionId, tpPrice, slPrice, tpQty, slQty } = body;
  if (!predictionId) return NextResponse.json({ error: "predictionId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: pred } = await admin
    .from("predictions").select("*").eq("id", predictionId).maybeSingle();
  if (!pred)                    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pred.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (pred.status !== "active") return NextResponse.json({ error: "not active" }, { status: 409 });

  const entry = Number(pred.entry_price);
  const tp    = tpPrice ?? Number(pred.tp_price);
  const sl    = slPrice ?? Number(pred.sl_price);

  // UP: TP ≥ entry, SL ≤ entry.  DOWN: TP ≤ entry, SL ≥ entry.
  const valid = pred.direction === "above"
    ? tp >= entry && sl <= entry
    : tp <= entry && sl >= entry;
  if (!valid) {
    return NextResponse.json(
      { error: "TP/SL on the wrong side of the entry price" },
      { status: 400 }
    );
  }

  const patch: Record<string, number> = {
    tp_price: round8(tp),
    sl_price: round8(sl),
  };
  if (tpQty != null) patch.tp_qty = clampQty(tpQty);
  if (slQty != null) patch.sl_qty = clampQty(slQty);

  const { data: updated, error } = await admin
    .from("predictions")
    .update(patch)
    .eq("id", predictionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prediction: updated });
}

function clampQty(v: number)  { return Math.max(1, Math.min(100, Math.round(v))); }
function round8(v: number)    { return Math.round(v * 1e8) / 1e8; }
