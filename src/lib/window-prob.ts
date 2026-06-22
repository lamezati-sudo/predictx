import type { Direction } from "@/types";

/** Raw tick from Supabase / API (canonical P(above)). */
export interface WindowProbTick {
  time_sec:   number;
  prob_above: number;
  spot_price: number;
}

/** Client tick — chart Y is frozen at ingest, never remapped. */
export interface ClientProbTick extends WindowProbTick {
  chartValue: number;
}

export type ProbPoint = { time: number; value: number };

export function tickChartValue(probAbove: number, direction: Direction): number {
  const p = direction === "above" ? probAbove : 1 - probAbove;
  return Math.round(p * 1000) / 10;
}

export function ingestTicks(raw: WindowProbTick[], direction: Direction): ClientProbTick[] {
  return raw
    .map((t) => ({
      ...t,
      chartValue: tickChartValue(t.prob_above, direction),
    }))
    .sort((a, b) => a.time_sec - b.time_sec);
}

export function ticksToChartPoints(ticks: ClientProbTick[]): ProbPoint[] {
  return ticks.map((t) => ({ time: t.time_sec, value: t.chartValue }));
}

/** Spot-price series from the same continuous tick feed (for the price view). */
export function ticksToPricePoints(ticks: ClientProbTick[]): ProbPoint[] {
  return ticks
    .filter((t) => t.spot_price > 0)
    .map((t) => ({ time: t.time_sec, value: t.spot_price }));
}

/** Merge a tick; chartValue is locked using direction at ingest time only. */
export function mergeTick(
  ticks: ClientProbTick[],
  incoming: WindowProbTick,
  direction: Direction
): ClientProbTick[] {
  const enriched: ClientProbTick = {
    ...incoming,
    chartValue: tickChartValue(incoming.prob_above, direction),
  };
  const idx = ticks.findIndex((t) => t.time_sec === incoming.time_sec);
  if (idx >= 0) {
    const next = [...ticks];
    next[idx] = enriched;
    return next;
  }
  return [...ticks, enriched].sort((a, b) => a.time_sec - b.time_sec);
}
