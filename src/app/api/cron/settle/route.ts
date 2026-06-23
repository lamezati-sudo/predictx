import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCloseAt } from "@/lib/server/prices";
import { calcLinearPnl } from "@/lib/probability";
import type { Asset, Direction } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/settle — runs every minute (Vercel Cron).
 * 1. Settles every window whose end time has passed (fixes close_price).
 * 2. Settles every active prediction past its expiry, crediting winnings.
 *
 * Authorized via the CRON_SECRET that Vercel sends in the Authorization header.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowISO = new Date().toISOString();
  const closeCache = new Map<string, number>(); // `${asset}@${endMs}` → close

  async function closePrice(asset: Asset, endMs: number): Promise<number> {
    const key = `${asset}@${endMs}`;
    if (closeCache.has(key)) return closeCache.get(key)!;
    const price = await fetchCloseAt(asset, endMs);
    closeCache.set(key, price);
    return price;
  }

  // ── 1. Settle expired windows ──────────────────────────────────────────
  const { data: openWindows } = await admin
    .from("windows")
    .select("*")
    .eq("status", "open")
    .lte("window_end", nowISO)
    .limit(200);

  for (const w of openWindows ?? []) {
    const endMs = new Date(w.window_end).getTime();
    const close = await closePrice(w.asset as Asset, endMs);
    await admin.from("windows")
      .update({ close_price: close, status: "settled" })
      .eq("id", w.id);
  }

  // ── 2. Settle expired active predictions ───────────────────────────────
  const { data: expired } = await admin
    .from("predictions")
    .select("*")
    .eq("status", "active")
    .lte("expires_at", nowISO)
    .limit(500);

  let settled = 0;
  for (const p of expired ?? []) {
    const endMs = new Date(p.expires_at).getTime();
    const close = await closePrice(p.asset as Asset, endMs);

    // Linear close at the window's final price.
    const pnl = Math.round(
      calcLinearPnl(Number(p.stake), Number(p.entry_price), close, p.direction as Direction) * 100
    ) / 100;

    await admin.rpc("settle_prediction", {
      p_prediction_id: p.id,
      p_status:        pnl > 0 ? "won" : "lost",
      p_pnl:           pnl,
      p_exit_price:    close,
      p_exit_prob:     null,
      p_exit_reason:   "expiry",
    });
    settled++;
  }

  return NextResponse.json({
    ok: true,
    windowsSettled: openWindows?.length ?? 0,
    predictionsSettled: settled,
  });
}
