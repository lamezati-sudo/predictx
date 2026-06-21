"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  mergeTick,
  ticksToChartPoints,
  type ProbPoint,
  type WindowProbTick,
} from "@/lib/window-prob";
import type { Direction } from "@/types";

/**
 * Shared window probability feed (listen-only):
 * - Loads persisted ticks from GET /api/window on mount
 * - Subscribes to Realtime Broadcast from the market worker (no client polling)
 * - Optional postgres_changes as backup when worker flush lands
 */
export function useWindowProbFeed(
  windowId: string | null,
  direction: Direction
) {
  const [ticks, setTicks]       = useState<WindowProbTick[]>([]);
  const [probData, setProbData] = useState<ProbPoint[]>([]);
  const ticksRef                = useRef<WindowProbTick[]>([]);
  const directionRef            = useRef(direction);
  directionRef.current          = direction;

  const applyChart = useCallback((raw: WindowProbTick[]) => {
    ticksRef.current = raw;
    setTicks(raw);
    setProbData(ticksToChartPoints(raw, directionRef.current));
  }, []);

  const applyOne = useCallback((incoming: WindowProbTick) => {
    applyChart(mergeTick(ticksRef.current, incoming));
  }, [applyChart]);

  useEffect(() => {
    setProbData(ticksToChartPoints(ticksRef.current, direction));
  }, [direction]);

  useEffect(() => {
    if (!windowId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`prob:${windowId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "tick" }, ({ payload }) => {
        const p = payload as WindowProbTick | undefined;
        if (!p?.time_sec) return;
        applyOne({
          time_sec:   Number(p.time_sec),
          prob_above: Number(p.prob_above),
          spot_price: Number(p.spot_price),
        });
      })
      // Backup: worker DB flush every 15s also triggers this
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "window_prob_ticks",
          filter: `window_id=eq.${windowId}`,
        },
        (payload) => {
          const row = payload.new as {
            time_sec?: number;
            prob_above?: number;
            spot_price?: number;
          } | null;
          if (!row?.time_sec) return;
          applyOne({
            time_sec:   Number(row.time_sec),
            prob_above: Number(row.prob_above),
            spot_price: Number(row.spot_price),
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [windowId, applyOne]);

  const loadTicks = useCallback((raw: WindowProbTick[]) => {
    applyChart(raw);
  }, [applyChart]);

  return { probData, loadTicks };
}
