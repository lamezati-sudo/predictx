"use client";

import { useEffect, useState } from "react";

/**
 * Forces a re-render every `intervalMs` so countdowns / live P&L refresh.
 * Settlement is server-side (cron + realtime), so nothing else is needed here.
 */
export function useTick(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
