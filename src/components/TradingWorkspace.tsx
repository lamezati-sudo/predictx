"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TradingChart, type TradingChartHandle } from "@/components/TradingChart";
import { useWindowProbFeed } from "@/hooks/useWindowProbFeed";
import { useGameStore } from "@/store/game-store";
import {
  createPriceStream,
  fetchWindowCandles,
  getWindowStart,
  getWindowEnd,
  msToWindowEnd,
} from "@/lib/prices";
import { calcDirectionProb, defaultProbLevels } from "@/lib/probability";
import type { WindowProbTick } from "@/lib/window-prob";
import type { Candle, Timeframe } from "@/types";
import { TIMEFRAME_MS } from "@/types";

type Asset = import("@/types").Asset;

export function TradingWorkspace() {
  const asset           = useGameStore((s) => s.asset);
  const timeframe       = useGameStore((s) => s.timeframe);
  const direction       = useGameStore((s) => s.direction);
  const windowId        = useGameStore((s) => s.windowId);
  const levels          = useGameStore((s) => s.levels);
  const targetPrice     = useGameStore((s) => s.targetPrice);
  const tpQty           = useGameStore((s) => s.tpQty);
  const slQty           = useGameStore((s) => s.slQty);
  const setLevels       = useGameStore((s) => s.setLevels);
  const syncLevelsToActive = useGameStore((s) => s.syncLevelsToActive);
  const checkTriggers   = useGameStore((s) => s.checkTriggers);
  const setWindow       = useGameStore((s) => s.setWindow);
  const setCurrentPrice = useGameStore((s) => s.setCurrentPrice);
  const setCurrentProb  = useGameStore((s) => s.setCurrentProb);
  const setTpQty        = useGameStore((s) => s.setTpQty);
  const setSlQty        = useGameStore((s) => s.setSlQty);
  const tickPrice       = useGameStore((s) => s.tickPrice);
  const currentPrice    = useGameStore((s) => s.currentPrice);
  const currentProb     = useGameStore((s) => s.currentProb);

  const { probData, loadTicks } = useWindowProbFeed(windowId, direction);

  const [candles,  setCandles]  = useState<Candle[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(0);

  const currentWindowRef = useRef<number>(0);
  const lastPriceRef     = useRef<number>(0);
  const lastStoreTickRef = useRef<number>(0);
  const directionRef     = useRef(direction);
  const targetRef        = useRef(targetPrice);
  const chartRef         = useRef<TradingChartHandle>(null);
  directionRef.current   = direction;
  targetRef.current      = targetPrice;

  // ─── Load window (server target + persisted prob history) ─────────────
  const loadWindow = useCallback(
    async (asset: Asset, tf: Timeframe, windowStart: number) => {
      setLoading(true);
      setError(null);
      setCandles([]);
      try {
        const [candles, winRes] = await Promise.all([
          fetchWindowCandles(asset, tf),
          fetch(`/api/window?asset=${asset}&timeframe=${tf}`),
        ]);
        if (getWindowStart(tf) !== windowStart) return;
        if (!winRes.ok) throw new Error("window unavailable");

        const { window: win, ticks } = (await winRes.json()) as {
          window: { id: string; target_price: number; window_end: string };
          ticks:  WindowProbTick[];
        };
        const target = Number(win.target_price);
        const endMs  = new Date(win.window_end).getTime();

        setCandles(candles);
        setWindow(win.id, target, endMs);
        targetRef.current = target;
        loadTicks(ticks ?? []);

        const price = candles[candles.length - 1]?.close ?? lastPriceRef.current;
        if (price > 0) {
          setCurrentPrice(price);
          lastPriceRef.current = price;
          const msLeft = msToWindowEnd(tf);
          const prob   = calcDirectionProb(directionRef.current, price, target, msLeft, TIMEFRAME_MS[tf]);
          const active = useGameStore.getState().predictions.find(
            (p) => p.status === "active" && p.asset === asset && p.timeframe === tf
          );
          if (active) {
            setLevels({
              entry:      active.entryProb,
              takeProfit: active.tpProb,
              stopLoss:   active.slProb,
            });
          } else {
            setLevels(defaultProbLevels(prob));
          }
          setCurrentProb(prob);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [setWindow, setCurrentPrice, setLevels, setCurrentProb, loadTicks]
  );

  useEffect(() => {
    const wStart = getWindowStart(timeframe);
    currentWindowRef.current = wStart;
    loadWindow(asset, timeframe, wStart);
  }, [asset, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown + auto-reset at wall-clock boundary
  useEffect(() => {
    const tick = () => {
      const ms = msToWindowEnd(timeframe);
      setWindowMs(ms);
      const newStart = getWindowStart(timeframe);
      if (newStart !== currentWindowRef.current) {
        currentWindowRef.current = newStart;
        loadWindow(asset, timeframe, newStart);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [asset, timeframe, loadWindow]);

  // Live WebSocket — BTC price + smooth intra-second prob on chart
  useEffect(() => {
    const STORE_INTERVAL_MS = 200;

    const cleanup = createPriceStream(
      asset,
      (candle) => {
        const wStart = currentWindowRef.current / 1000;
        setCandles((prev) => {
          const filtered = prev.filter((c) => c.time >= wStart);
          if (filtered.length === 0) return [candle];
          const last = filtered[filtered.length - 1];
          return last.time === candle.time
            ? [...filtered.slice(0, -1), candle]
            : [...filtered, candle];
        });
      },
      (price) => {
        lastPriceRef.current = price;
        chartRef.current?.updateLivePrice(price);

        const target = targetRef.current;
        const ms     = msToWindowEnd(timeframe);
        const prob   = target > 0
          ? calcDirectionProb(directionRef.current, price, target, ms, TIMEFRAME_MS[timeframe])
          : 0.5;
        const timeSec = Math.floor(Date.now() / 1000);
        chartRef.current?.updateLiveProb(prob, timeSec);

        const now = Date.now();
        if (now - lastStoreTickRef.current >= STORE_INTERVAL_MS) {
          lastStoreTickRef.current = now;
          setCurrentPrice(price);
          setCurrentProb(prob);
          tickPrice(asset, price, prob);
        }
      }
    );
    return cleanup;
  }, [asset, setCurrentPrice, setCurrentProb, tickPrice, timeframe, checkTriggers]);

  // Also check TP/SL when probability moves (chart line crosses bar)
  useEffect(() => {
    const price = lastPriceRef.current;
    if (price <= 0 || targetRef.current <= 0) return;
    checkTriggers(asset, price, currentProb);
  }, [asset, checkTriggers, currentProb]);

  // Recompute TP/SL levels when direction toggles (chart remaps via useWindowProbFeed)
  useEffect(() => {
    const price  = lastPriceRef.current;
    const target = targetRef.current;
    if (price > 0 && target > 0) {
      const ms   = msToWindowEnd(timeframe);
      const prob = calcDirectionProb(direction, price, target, ms, TIMEFRAME_MS[timeframe]);
      setLevels(defaultProbLevels(prob));
      setCurrentProb(prob);
    }
  }, [direction, timeframe, setLevels, setCurrentProb]);

  const handleLevelsChange = useCallback(
    (newLevels: typeof levels) => { if (newLevels) setLevels(newLevels); },
    [setLevels]
  );
  const handleLevelsCommit = useCallback(
    (newLevels: typeof levels) => {
      if (!newLevels) return;
      setLevels(newLevels);
      syncLevelsToActive(newLevels);
      const price = lastPriceRef.current;
      if (price > 0) checkTriggers(asset, price, useGameStore.getState().currentProb);
    },
    [setLevels, syncLevelsToActive, checkTriggers, asset]
  );
  const handleTpQtyChange = useCallback((qty: number) => {
    setTpQty(qty);
    const lv = useGameStore.getState().levels;
    if (lv) syncLevelsToActive(lv, qty, undefined);
  }, [setTpQty, syncLevelsToActive]);
  const handleSlQtyChange = useCallback((qty: number) => {
    setSlQty(qty);
    const lv = useGameStore.getState().levels;
    if (lv) syncLevelsToActive(lv, undefined, qty);
  }, [setSlQty, syncLevelsToActive]);

  const windowStartSec = Math.floor(getWindowStart(timeframe) / 1000);
  const windowEndSec   = Math.floor(getWindowEnd(timeframe) / 1000);

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0a0a]">
          <div className="flex items-center gap-2 text-[#444]">
            <span className="h-4 w-4 animate-spin rounded-full border border-[#333] border-t-[#555]" />
            <span className="font-mono text-xs">loading window…</span>
          </div>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2">
          <p className="text-sm text-[#ff3b5b]">Failed to load</p>
          <p className="font-mono text-xs text-[#444]">{error}</p>
        </div>
      )}
      <TradingChart
        ref={chartRef}
        asset={asset}
        timeframe={timeframe}
        candles={candles}
        probData={probData}
        currentPrice={currentPrice}
        targetPrice={targetPrice}
        windowStartSec={windowStartSec}
        windowEndSec={windowEndSec}
        windowMsRemaining={windowMs}
        levels={levels}
        direction={direction}
        tpQty={tpQty}
        slQty={slQty}
        onLevelsChange={handleLevelsChange}
        onLevelsCommit={handleLevelsCommit}
        onTpQtyChange={handleTpQtyChange}
        onSlQtyChange={handleSlQtyChange}
      />
    </div>
  );
}
