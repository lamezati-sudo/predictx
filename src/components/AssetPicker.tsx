"use client";

import { ASSETS } from "@/types";
import type { Asset } from "@/types";
import { useGameStore } from "@/store/game-store";

export function AssetPicker() {
  const asset = useGameStore((s) => s.asset);
  const setAsset = useGameStore((s) => s.setAsset);

  return (
    <div className="flex items-center gap-0 rounded border border-[#1e1e1e] bg-[#111] p-0.5">
      {ASSETS.map((a) => (
        <button
          key={a.id}
          onClick={() => setAsset(a.id as Asset)}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-all ${
            asset === a.id
              ? "bg-[#1e1e1e] text-white"
              : "text-[#555] hover:text-[#aaa]"
          }`}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: asset === a.id ? a.color : "#444" }}
          />
          {a.id}
        </button>
      ))}
    </div>
  );
}
