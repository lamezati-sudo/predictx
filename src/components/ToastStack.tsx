"use client";

import { useEffect } from "react";
import { useGameStore } from "@/store/game-store";

export function ToastStack() {
  const toasts      = useGameStore((s) => s.toasts);
  const dismissToast = useGameStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: { id: string; type: "win" | "loss" | "info"; message: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const accent = {
    win:  { border: "#00c47a", text: "#00c47a", dot: "●" },
    loss: { border: "#ff3b5b", text: "#ff3b5b", dot: "●" },
    info: { border: "#f0b90b", text: "#e2e2e2", dot: "◆" },
  }[toast.type];

  return (
    <div
      className="toast-in pointer-events-auto flex max-w-xs items-start gap-2.5 rounded bg-[#111] px-3.5 py-3 shadow-2xl"
      style={{ boxShadow: `0 0 0 1px ${accent.border}44, 0 8px 24px #00000088` }}
    >
      <span className="mt-px text-[11px]" style={{ color: accent.border }}>{accent.dot}</span>
      <span className="flex-1 text-[12px] text-[#ccc]">{toast.message}</span>
      <button onClick={onDismiss} className="mt-px text-[#444] hover:text-[#888]">✕</button>
    </div>
  );
}
