import type { Direction } from "@/types";

/** Raw tick from Supabase / API (canonical P(above)). */
export interface WindowProbTick {
  time_sec:   number;
  prob_above: number;
  spot_price: number;
}

export type ProbPoint = { time: number; value: number };

export function ticksToChartPoints(ticks: WindowProbTick[], direction: Direction): ProbPoint[] {
  return ticks.map((t) => ({
    time:  t.time_sec,
    value: (direction === "above" ? t.prob_above : 1 - t.prob_above) * 100,
  }));
}

/** Merge a tick into the sorted series (replace same second). */
export function mergeTick(
  ticks: WindowProbTick[],
  incoming: WindowProbTick
): WindowProbTick[] {
  const idx = ticks.findIndex((t) => t.time_sec === incoming.time_sec);
  if (idx >= 0) {
    const next = [...ticks];
    next[idx] = incoming;
    return next;
  }
  const next = [...ticks, incoming].sort((a, b) => a.time_sec - b.time_sec);
  return next;
}
