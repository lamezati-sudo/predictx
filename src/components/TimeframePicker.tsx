"use client";

import { TIMEFRAMES, type Timeframe } from "@/types";
import { useGameStore } from "@/store/game-store";

export function TimeframePicker() {
  const timeframe = useGameStore((s) => s.timeframe);
  const setTimeframe = useGameStore((s) => s.setTimeframe);

  return (
    <div className="flex items-center gap-0 rounded border border-[#1e1e1e] bg-[#111] p-0.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.id}
          onClick={() => setTimeframe(tf.id as Timeframe)}
          className={`rounded px-3 py-1.5 text-xs font-semibold transition-all ${
            timeframe === tf.id
              ? "bg-[#f0b90b] text-black"
              : "text-[#555] hover:text-[#aaa]"
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
