"use client";

import { create } from "zustand";
import type { ActivePrediction, Asset, Direction, PriceLevels, Timeframe, PredictionStatus } from "@/types";
import { checkPredictionTriggers } from "@/lib/prediction-engine";

interface Toast {
  id: string;
  type: "win" | "loss" | "info";
  message: string;
}

/** Raw row shape returned by the predictions table / API. */
export interface PredictionRow {
  id: string;
  asset: string;
  timeframe: string;
  direction: string;
  entry_price: number;
  target_price: number;
  tp_price: number;
  sl_price: number;
  tp_qty: number;
  sl_qty: number;
  stake: number;
  status: string;
  pnl: number | null;
  exit_price: number | null;
  exit_reason: string | null;
  opened_at: string;
  expires_at: string;
  settled_at: string | null;
}

export interface ProfileRow {
  balance: number;
  xp: number;
  streak: number;
  best_streak: number;
  total_wins: number;
  total_losses: number;
  username: string | null;
}

function rowToPrediction(r: PredictionRow): ActivePrediction {
  return {
    id:          r.id,
    asset:       r.asset as Asset,
    timeframe:   r.timeframe as Timeframe,
    direction:   r.direction as Direction,
    entryPrice:  Number(r.entry_price),
    targetPrice: Number(r.target_price),
    tpPrice:     Number(r.tp_price),
    slPrice:     Number(r.sl_price),
    tpQty:       r.tp_qty,
    slQty:       r.sl_qty,
    stake:       Number(r.stake),
    openedAt:    new Date(r.opened_at).getTime(),
    expiresAt:   new Date(r.expires_at).getTime(),
    status:      r.status as PredictionStatus,
    pnl:         r.pnl   == null ? undefined : Number(r.pnl),
    exitPrice:   r.exit_price == null ? undefined : Number(r.exit_price),
    exitReason:  (r.exit_reason as ActivePrediction["exitReason"]) ?? undefined,
  };
}

interface GameState {
  // ── Server-synced (authoritative) ──
  userId:      string | null;
  username:    string | null;
  balance:     number;
  xp:          number;
  streak:      number;
  bestStreak:  number;
  totalWins:   number;
  totalLosses: number;
  predictions: ActivePrediction[]; // active
  history:     ActivePrediction[]; // settled
  ready:       boolean;            // initial server load done

  // ── Current window (server-authoritative) ──
  windowId:    string | null;
  windowEnd:   number;             // epoch ms

  // ── UI / ephemeral ──
  asset:        Asset;
  timeframe:    Timeframe;
  direction:    Direction;
  levels:       PriceLevels | null;
  targetPrice:  number;
  stake:        number;
  tpQty:        number;
  slQty:        number;
  currentPrice: number;
  prices:       Record<Asset, number>;
  toasts:       Toast[];

  // ── Sync actions (called by AccountProvider) ──
  setUser:          (id: string | null, username: string | null) => void;
  syncProfile:      (p: ProfileRow) => void;
  syncPredictions:  (rows: PredictionRow[]) => void;
  upsertPrediction: (row: PredictionRow) => void;

  // ── UI actions ──
  setAsset:        (asset: Asset)         => void;
  setTimeframe:    (timeframe: Timeframe) => void;
  setDirection:    (direction: Direction) => void;
  setLevels:       (levels: PriceLevels)  => void;
  setTargetPrice:  (price: number)        => void;
  setStake:        (stake: number)        => void;
  setTpQty:        (qty: number)          => void;
  setSlQty:        (qty: number)          => void;
  setCurrentPrice: (price: number)        => void;
  setWindow:       (id: string | null, targetPrice: number, end: number) => void;

  // ── Server-backed game actions ──
  placePrediction: () => Promise<boolean>;
  syncLevelsToActive: (levels: PriceLevels, tpQty?: number, slQty?: number) => void;
  checkTriggers:     (asset: Asset, price: number) => void;
  tickPrice:         (asset: Asset, price: number) => void;
  dismissToast:      (id: string) => void;
}

const STARTING_BALANCE = 10_000;

// Track predictions we've already fired an exit request for, to avoid spamming
const exiting = new Set<string>();

function addToast(toasts: Toast[], type: Toast["type"], message: string): Toast[] {
  return [...toasts, { id: crypto.randomUUID(), type, message }].slice(-4);
}

export const useGameStore = create<GameState>()((set, get) => ({
  userId:      null,
  username:    null,
  balance:     STARTING_BALANCE,
  xp:          0,
  streak:      0,
  bestStreak:  0,
  totalWins:   0,
  totalLosses: 0,
  predictions: [],
  history:     [],
  ready:       false,

  windowId:    null,
  windowEnd:   0,

  asset:        "BTC",
  timeframe:    "15m",
  direction:    "above",
  levels:       null,
  targetPrice:  0,
  stake:        100,
  tpQty:        100,
  slQty:        100,
  currentPrice: 0,
  prices:       { BTC: 0, ETH: 0, SOL: 0 },
  toasts:       [],

  // ── Sync ──
  setUser: (id, username) => set({ userId: id, username }),

  syncProfile: (p) => set({
    balance:     Number(p.balance),
    xp:          p.xp,
    streak:      p.streak,
    bestStreak:  p.best_streak,
    totalWins:   p.total_wins,
    totalLosses: p.total_losses,
    username:    p.username ?? get().username,
  }),

  syncPredictions: (rows) => {
    const mapped = rows.map(rowToPrediction);
    const s = get();
    set({
      predictions: mapped.filter((p) => p.status === "active"),
      history:     mapped.filter((p) => p.status !== "active").slice(0, 50),
      ready:       true,
    });
    // Restore chart TP/SL from active trade for current asset/timeframe
    const active = mapped.find(
      (p) => p.status === "active" && p.asset === s.asset && p.timeframe === s.timeframe
    );
    if (active) {
      set({
        levels: {
          entry:      active.entryPrice,
          takeProfit: active.tpPrice,
          stopLoss:   active.slPrice,
        },
        tpQty: active.tpQty,
        slQty: active.slQty,
      });
    }
  },

  upsertPrediction: (row) => {
    const p = rowToPrediction(row);
    const s = get();
    const wasActive = s.predictions.find((x) => x.id === p.id);
    if (p.status === "active") {
      const others = s.predictions.filter((x) => x.id !== p.id);
      set({ predictions: [...others, p] });
    } else {
      // Just settled — move to history, toast the result
      exiting.delete(p.id);
      const newHistory = [p, ...s.history.filter((x) => x.id !== p.id)].slice(0, 50);
      let toasts = s.toasts;
      if (wasActive) {
        const win = (p.pnl ?? 0) > 0;
        toasts = addToast(toasts, win ? "win" : "loss",
          win
            ? `${labelFor(p)} +$${(p.pnl ?? 0).toFixed(2)}`
            : `${labelFor(p)} -$${Math.abs(p.pnl ?? 0).toFixed(2)}`);
      }
      set({
        predictions: s.predictions.filter((x) => x.id !== p.id),
        history:     newHistory,
        toasts,
      });
    }
  },

  // ── UI ──
  setAsset:        (asset)     => set({ asset,     levels: null, targetPrice: 0, windowId: null }),
  setTimeframe:    (timeframe) => set({ timeframe, levels: null, targetPrice: 0, windowId: null }),
  setDirection:    (direction) => set({ direction }),
  setLevels:       (levels)    => set({ levels }),
  setTargetPrice:  (price)     => set({ targetPrice: price }),
  setStake:        (stake)     => set({ stake: Math.max(1, Math.min(stake, get().balance)) }),
  setTpQty:        (qty)       => set({ tpQty: Math.max(1, Math.min(100, Math.round(qty))) }),
  setSlQty:        (qty)       => set({ slQty: Math.max(1, Math.min(100, Math.round(qty))) }),
  setCurrentPrice: (price)     => set({ currentPrice: price }),
  setWindow:       (id, targetPrice, end) => set({ windowId: id, targetPrice, windowEnd: end }),

  // ── Place (server) ──
  placePrediction: async () => {
    const s = get();
    const { levels, stake, balance, direction, windowId } = s;
    if (!windowId || !levels || stake <= 0 || stake > balance) return false;
    // UP: TP above entry, SL below. DOWN: TP below entry, SL above.
    if (direction === "above") {
      if (levels.takeProfit < levels.entry || levels.stopLoss > levels.entry) return false;
    } else {
      if (levels.takeProfit > levels.entry || levels.stopLoss < levels.entry) return false;
    }

    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windowId,
          direction,
          stake,
          tpPrice: levels.takeProfit,
          slPrice: levels.stopLoss,
          tpQty:  s.tpQty,
          slQty:  s.slQty,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "failed" }));
        set({ toasts: addToast(s.toasts, "loss", `Couldn't place: ${error}`) });
        return false;
      }
      const { prediction } = await res.json();
      // Optimistic: realtime will also deliver this, upsert dedupes by id
      get().upsertPrediction(prediction as PredictionRow);
      set({
        balance: get().balance - stake,
        levels:  {
          entry:      levels.entry,
          takeProfit: levels.takeProfit,
          stopLoss:   levels.stopLoss,
        },
        toasts:  addToast(get().toasts, "info",
          `${direction.toUpperCase()} ${s.asset} @ $${levels.entry.toLocaleString("en-US", { maximumFractionDigits: 2 })}`),
      });
      return true;
    } catch {
      set({ toasts: addToast(get().toasts, "loss", "Network error") });
      return false;
    }
  },

  /** Push dragged TP/SL to the active prediction on the server. */
  syncLevelsToActive: (levels, tpQty, slQty) => {
    const s = get();
    const pred = s.predictions.find(
      (p) => p.status === "active" && p.asset === s.asset && p.timeframe === s.timeframe
    );
    if (!pred) return;

      // Optimistic local update so triggers fire immediately
      set({
        levels,
        predictions: s.predictions.map((p) =>
        p.id === pred.id
          ? { ...p, tpPrice: levels.takeProfit, slPrice: levels.stopLoss,
              tpQty: tpQty ?? p.tpQty, slQty: slQty ?? p.slQty }
          : p
      ),
    });

    fetch("/api/predictions/levels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId: pred.id,
        tpPrice:      levels.takeProfit,
        slPrice:      levels.stopLoss,
        tpQty:        tpQty ?? s.tpQty,
        slQty:        slQty ?? s.slQty,
      }),
    })
      .then(async (r) => {
        if (!r.ok) return;
        const { prediction } = await r.json();
        if (prediction) get().upsertPrediction(prediction as PredictionRow);
      })
      .catch(() => { /* realtime / next drag will retry */ });
  },

  /** Check TP/SL price levels for all active predictions on this asset. */
  checkTriggers: (asset, price) => {
    const s = get();
    const now = Date.now();

    for (const p of s.predictions) {
      if (p.status !== "active" || p.asset !== asset) continue;
      if (now >= p.expiresAt) continue;
      if (exiting.has(p.id)) continue;

      // Use chart levels when they belong to this open trade, else stored ones
      const uiLevels = p.asset === s.asset && p.timeframe === s.timeframe ? s.levels : null;
      const effective: ActivePrediction = uiLevels
        ? { ...p, tpPrice: uiLevels.takeProfit, slPrice: uiLevels.stopLoss }
        : p;

      const reason = checkPredictionTriggers(effective, price);
      if (!reason) continue;

      exiting.add(p.id);
      fetch("/api/predictions/exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: p.id, reason }),
      })
        .then(async (r) => {
          if (!r.ok) {
            exiting.delete(p.id);
            const err = await r.json().catch(() => ({}));
            set({ toasts: addToast(get().toasts, "info", `Exit pending: ${err.error ?? r.status}`) });
            return;
          }
          // Realtime moves prediction to history
        })
        .catch(() => { exiting.delete(p.id); });
    }
  },

  tickPrice: (asset, price) => {
    const s = get();
    set({
      currentPrice: asset === s.asset ? price : s.currentPrice,
      prices:       { ...s.prices, [asset]: price },
    });
    get().checkTriggers(asset, price);
  },

  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
}));

function labelFor(p: ActivePrediction): string {
  const tag = p.exitReason === "tp" ? "TP hit"
            : p.exitReason === "sl" ? "SL hit"
            : p.exitReason === "expiry" ? "Window closed"
            : "Closed";
  return `${tag} — ${p.direction.toUpperCase()} ${p.asset}`;
}
