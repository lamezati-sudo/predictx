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
    tpProb?: number;
    slProb?: number;
    tpQty?: number;
    slQty?: number;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const { predictionId, tpProb, slProb, tpQty, slQty } = body;
  if (!predictionId) return NextResponse.json({ error: "predictionId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: pred } = await admin
    .from("predictions").select("*").eq("id", predictionId).maybeSingle();
  if (!pred)                    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pred.user_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (pred.status !== "active") return NextResponse.json({ error: "not active" }, { status: 409 });

  const entry = Number(pred.entry_prob);
  const tp    = clampProb(tpProb ?? Number(pred.tp_prob));
  const sl    = clampProb(slProb ?? Number(pred.sl_prob));

  if (!(tp > entry && sl < entry)) {
    return NextResponse.json(
      { error: "TP must be above entry and SL below entry" },
      { status: 400 }
    );
  }

  const patch: Record<string, number> = {
    tp_prob: round5(tp),
    sl_prob: round5(sl),
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

function clampProb(v: number) { return Math.max(0.01, Math.min(0.99, v)); }
function clampQty(v: number)  { return Math.max(1, Math.min(100, Math.round(v))); }
function round5(v: number)    { return Math.round(v * 1e5) / 1e5; }
