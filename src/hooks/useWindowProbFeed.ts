"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ingestTicks,
  mergeTick,
  ticksToChartPoints,
  type ClientProbTick,
  type ProbPoint,
  type WindowProbTick,
} from "@/lib/window-prob";
import type { Direction } from "@/types";

/**
 * Shared window probability feed (listen-only):
 * - Loads persisted ticks from GET /api/window on mount
 * - Subscribes to Realtime Broadcast from the market worker
 * - Optional postgres_changes as backup when worker flush lands
 *
 * Historical chart values are frozen at ingest — direction changes do not
 * rewrite past points.
 */
export function useWindowProbFeed(
  windowId: string | null,
  direction: Direction
) {
  const [probData, setProbData] = useState<ProbPoint[]>([]);
  const ticksRef                = useRef<ClientProbTick[]>([]);
  const directionRef            = useRef(direction);
  directionRef.current          = direction;
  // Which window the ticks currently in state belong to — lets us skip the
  // clear-on-windowId reset when history for this window was just loaded
  // (avoids a race that wiped the graph on refresh).
  const dataWindowRef           = useRef<string | null>(null);

  const applyChart = useCallback((raw: ClientProbTick[]) => {
    ticksRef.current = raw;
    setProbData(ticksToChartPoints(raw));
  }, []);

  const applyOne = useCallback((incoming: WindowProbTick) => {
    applyChart(mergeTick(ticksRef.current, incoming, directionRef.current));
  }, [applyChart]);

  // New window → clear series (fresh graph for new target), unless freshly
  // loaded history for this exact window is already in state.
  useEffect(() => {
    if (dataWindowRef.current === windowId) return;
    ticksRef.current = [];
    setProbData([]);
  }, [windowId]);

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

  const loadTicks = useCallback((raw: WindowProbTick[], forWindowId: string | null) => {
    dataWindowRef.current = forWindowId;
    applyChart(ingestTicks(raw, directionRef.current));
  }, [applyChart]);

  return { probData, loadTicks };
}
