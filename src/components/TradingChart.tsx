"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  LineType,
} from "lightweight-charts";
import type { Asset, Direction, PriceLevels, Timeframe } from "@/types";
import { formatPrice, TIMEFRAMES } from "@/types";
import type { ProbPoint } from "@/lib/window-prob";
import { calcLinearPnl } from "@/lib/probability";
import { useGameStore } from "@/store/game-store";

export interface TradingChartHandle {
  updateLivePrice: (price: number) => void;
}

type DraggableKind = "stopLoss" | "takeProfit";

interface Props {
  asset:             Asset;
  timeframe:         Timeframe;
  priceData:         ProbPoint[];
  currentPrice:      number;
  targetPrice:       number;
  windowStartSec:    number;
  windowEndSec:      number;
  windowMsRemaining: number;
  levels:            PriceLevels | null;
  direction:         Direction;
  tpQty:             number;
  slQty:             number;
  onLevelsChange:    (levels: PriceLevels) => void;
  onLevelsCommit?:   (levels: PriceLevels) => void;
  onTpQtyChange:     (qty: number) => void;
  onSlQtyChange:     (qty: number) => void;
}

function fmtCountdown(ms: number) {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TradingChart = forwardRef<TradingChartHandle, Props>(function TradingChart({
  asset, timeframe, priceData, currentPrice, targetPrice,
  windowStartSec, windowEndSec,
  windowMsRemaining, levels, direction,
  tpQty, slQty, onLevelsChange, onLevelsCommit, onTpQtyChange, onSlQtyChange,
}, ref) {
  const storeStake  = useGameStore((s) => s.stake);
  const predictions = useGameStore((s) => s.predictions);
  // The open position on this market drives the P&L preview stake/entry.
  const activePos = predictions.find(
    (p) => p.status === "active" && p.asset === asset && p.timeframe === timeframe
  );
  const stake = activePos?.stake ?? storeStake;

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef   = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const [dragging, setDragging] = useState<DraggableKind | null>(null);
  const [lineY,   setLineY]   = useState({ tp: 0, sl: 0, target: 0, live: 0, entry: 0 });

  const latestPriceTimeRef    = useRef<number>(0);
  const priceDataLenRef       = useRef(0);
  const priceRangeRef         = useRef({ min: 0, max: 0 });
  const levelsRef             = useRef(levels);
  const currentPriceRef       = useRef(currentPrice);
  const targetPriceRef        = useRef(targetPrice);
  const directionRef          = useRef(direction);
  const windowRangeRef        = useRef({ start: 0, end: 0 });

  levelsRef.current       = levels;
  currentPriceRef.current = currentPrice;
  targetPriceRef.current  = targetPrice;
  directionRef.current    = direction;

  const applyWindowRange = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || windowStartSec <= 0 || windowEndSec <= 0) return;
    if (windowEndSec <= windowStartSec) return;
    try {
      chart.timeScale().setVisibleRange({
        from: windowStartSec as Time,
        to:   windowEndSec as Time,
      });
    } catch {
      // Chart may not be ready yet — ignore
    }
  }, [windowStartSec, windowEndSec]);

  // ─── Price-axis autoscale that always keeps target + TP/SL in view ─────
  const autoscale = useCallback(() => {
    const r    = priceRangeRef.current;
    const lvls = levelsRef.current;
    const vals: number[] = [];
    if (r.min > 0) { vals.push(r.min, r.max); }
    if (targetPriceRef.current > 0) vals.push(targetPriceRef.current);
    if (currentPriceRef.current > 0) vals.push(currentPriceRef.current);
    if (lvls) { vals.push(lvls.takeProfit, lvls.stopLoss, lvls.entry); }
    if (vals.length === 0) return null;
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min *= 0.999; max *= 1.001; }
    const pad = (max - min) * 0.12 || max * 0.001;
    return { priceRange: { minValue: min - pad, maxValue: max + pad } };
  }, []);

  const applyAutoscale = useCallback(() => {
    priceSeriesRef.current?.applyOptions({ autoscaleInfoProvider: autoscale });
  }, [autoscale]);

  // ─── Sync overlay Y positions (price coordinates) ──────────────────────
  const updatePositions = useCallback(() => {
    const lvls   = levelsRef.current;
    const series = priceSeriesRef.current;
    if (!lvls || !series) return;
    const tpY     = series.priceToCoordinate(lvls.takeProfit);
    const slY     = series.priceToCoordinate(lvls.stopLoss);
    const entryY  = series.priceToCoordinate(lvls.entry);
    const targetY = targetPriceRef.current > 0 ? series.priceToCoordinate(targetPriceRef.current) : null;
    const liveY   = currentPriceRef.current > 0 ? series.priceToCoordinate(currentPriceRef.current) : null;
    setLineY((prev) => ({
      tp:     tpY     ?? prev.tp,
      sl:     slY     ?? prev.sl,
      target: targetY ?? prev.target,
      live:   liveY   ?? prev.live,
      entry:  entryY  ?? prev.entry,
    }));
  }, []);

  // ─── Imperative handle ─────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    updateLivePrice: (price: number) => {
      if (price <= 0) return;
      currentPriceRef.current = price;
      const series = priceSeriesRef.current;
      const t = latestPriceTimeRef.current;
      if (series && t > 0 && priceDataLenRef.current > 0) {
        series.update({ time: t as Time, value: price });
      }
      applyAutoscale();
      requestAnimationFrame(updatePositions);
    },
  }), [updatePositions, applyAutoscale]);

  // ─── Create chart ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#444",
        fontFamily: "ui-monospace, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "#0d0d0d" },
        horzLines: { color: "#111" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#252525", labelBackgroundColor: "#111" },
        horzLine: { color: "#252525", labelBackgroundColor: "#111" },
      },
      rightPriceScale: {
        borderColor: "#161616",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#161616",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // Continuous price line from the 1 Hz spot-price tick feed.
    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor:   "#e2e2e2",
      lineWidth:   2,
      lineType:    LineType.Simple,
      topColor:    "rgba(226,226,226,0.07)",
      bottomColor: "rgba(0,0,0,0)",
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: autoscale,
    });

    priceSeriesRef.current = priceSeries;
    chartRef.current       = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        requestAnimationFrame(updatePositions);
      }
    });
    ro.observe(containerRef.current);
    chart.timeScale().subscribeVisibleLogicalRangeChange(() =>
      requestAnimationFrame(updatePositions)
    );

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current       = null;
      priceSeriesRef.current = null;
    };
  }, [updatePositions, autoscale]);

  // ─── Lock X-axis to full wall-clock window; clear on window change ─────
  useEffect(() => {
    const changed =
      windowRangeRef.current.start !== windowStartSec ||
      windowRangeRef.current.end !== windowEndSec;
    if (changed) {
      windowRangeRef.current = { start: windowStartSec, end: windowEndSec };
      priceDataLenRef.current = 0;
      latestPriceTimeRef.current = 0;
      priceRangeRef.current = { min: 0, max: 0 };
      priceSeriesRef.current?.setData([]);
    }
    applyWindowRange();
  }, [windowStartSec, windowEndSec, applyWindowRange]);

  // ─── Feed price data (continuous spot-price line from the tick feed) ───
  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series) return;

    if (priceData.length === 0) {
      if (priceDataLenRef.current !== 0) {
        series.setData([]);
        priceDataLenRef.current = 0;
        latestPriceTimeRef.current = 0;
        priceRangeRef.current = { min: 0, max: 0 };
      }
      return;
    }

    series.setData(priceData.map((p) => ({ time: p.time as Time, value: p.value })));
    priceDataLenRef.current = priceData.length;
    latestPriceTimeRef.current = priceData[priceData.length - 1].time;

    let min = Infinity, max = -Infinity;
    for (const p of priceData) { if (p.value < min) min = p.value; if (p.value > max) max = p.value; }
    priceRangeRef.current = { min, max };

    const up = priceData[priceData.length - 1].value >= priceData[0].value;
    series.applyOptions({
      lineColor:   up ? "#00c47a" : "#ff3b5b",
      topColor:    up ? "rgba(0,196,122,0.12)" : "rgba(255,59,91,0.10)",
      bottomColor: "rgba(0,0,0,0)",
    });
    applyAutoscale();
    applyWindowRange();
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [priceData, updatePositions, applyWindowRange, applyAutoscale]);

  // ─── Live price tip (smooth the latest point between worker ticks) ─────
  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series || currentPrice <= 0) return;
    currentPriceRef.current = currentPrice;
    const t = latestPriceTimeRef.current;
    if (t > 0 && priceDataLenRef.current > 0) {
      series.update({ time: t as Time, value: currentPrice });
    }
    applyAutoscale();
    requestAnimationFrame(updatePositions);
  }, [currentPrice, updatePositions, applyAutoscale]);

  // ─── Re-evaluate scale + overlay on levels / target change ─────────────
  useEffect(() => {
    applyAutoscale();
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [levels, targetPrice, updatePositions, applyAutoscale]);

  // ─── Drag handlers (price units) ───────────────────────────────────────
  const priceFromY = useCallback((clientY: number): number | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const y = clientY - rect.top;
    const v = priceSeriesRef.current?.coordinateToPrice(y);
    return v != null && v > 0 ? Number(v) : null;
  }, []);

  const onPointerDown = (kind: DraggableKind) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(kind);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !levelsRef.current) return;
    const val = priceFromY(e.clientY);
    if (val == null) return;
    const lvls  = levelsRef.current;
    const entry = lvls.entry;
    const dir   = directionRef.current;
    const next  = { ...lvls };
    // UP: TP ≥ entry, SL ≤ entry.  DOWN: TP ≤ entry, SL ≥ entry.
    if (dragging === "takeProfit") {
      next.takeProfit = dir === "above" ? Math.max(entry, val) : Math.min(entry, val);
    } else {
      next.stopLoss = dir === "above" ? Math.min(entry, val) : Math.max(entry, val);
    }
    onLevelsChange(next);
  }, [dragging, priceFromY, onLevelsChange]);

  const stopDrag = () => {
    if (dragging && levelsRef.current && onLevelsCommit) {
      onLevelsCommit(levelsRef.current);
    }
    setDragging(null);
  };

  // ─── Derived ──────────────────────────────────────────────────────────
  const livePrice = currentPrice > 0
    ? currentPrice
    : priceData.length > 0 ? priceData[priceData.length - 1].value : 0;
  const isWinning = direction === "above"
    ? livePrice > targetPrice
    : livePrice > 0 && livePrice < targetPrice;
  const urgency   = windowMsRemaining < 30_000  ? "critical"
                  : windowMsRemaining < 120_000 ? "warning"
                  : "normal";
  const timerColor = urgency === "critical" ? "#ff3b5b"
                   : urgency === "warning"  ? "#f0b90b"
                   : "#666";
  const tfLabel = TIMEFRAMES.find((t) => t.id === timeframe)?.label ?? timeframe;

  const tpPnl = levels ? calcLinearPnl(stake, levels.entry, levels.takeProfit, direction) : 0;
  const slPnl = levels ? calcLinearPnl(stake, levels.entry, levels.stopLoss,   direction) : 0;
  const showEntry = !!activePos && !!levels &&
    Math.abs(levels.entry - livePrice) / Math.max(1, levels.entry) > 0.00005;

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {levels && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10"
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
        >
          {/* Target — "Price to Beat" (dashed) */}
          {targetPrice > 0 && (
            <div className="pointer-events-none absolute left-0 flex items-center" style={{
              right: 0, top: lineY.target, transform: "translateY(-50%)", zIndex: 7,
            }}>
              <div className="flex-1" style={{
                height: 1,
                background: "repeating-linear-gradient(to right,rgba(255,255,255,0.45) 0,rgba(255,255,255,0.45) 6px,transparent 6px,transparent 12px)",
              }} />
              <div className="flex items-center gap-1.5 bg-[#090909] px-2.5 py-[3px] text-[11px]"
                style={{ color: "#cfcfcf", borderLeft: "1px solid #555" }}>
                <span className="opacity-50 text-[10px]">PRICE TO BEAT</span>
                <span className="font-mono text-white">${formatPrice(targetPrice, asset)}</span>
              </div>
            </div>
          )}

          {/* Entry line (only when there's an open position away from live) */}
          {showEntry && (
            <div className="pointer-events-none absolute left-0 flex items-center" style={{
              right: 0, top: lineY.entry, transform: "translateY(-50%)", zIndex: 6,
            }}>
              <div className="flex-1" style={{
                height: 1,
                background: "repeating-linear-gradient(to right,rgba(240,185,11,0.35) 0,rgba(240,185,11,0.35) 4px,transparent 4px,transparent 10px)",
              }} />
              <div className="flex items-center gap-1.5 bg-[#090909] px-2 py-[2px] text-[10px]"
                style={{ color: "#b9902a", borderLeft: "1px solid #6b5414" }}>
                <span className="opacity-60">ENTRY</span>
                <span className="font-mono">${formatPrice(levels.entry, asset)}</span>
              </div>
            </div>
          )}

          {/* Live current price */}
          {livePrice > 0 && (
            <div className="pointer-events-none absolute left-0 flex items-center" style={{
              right: 0, top: lineY.live, transform: "translateY(-50%)", zIndex: 8,
            }}>
              <div className="flex-1" style={{
                height: 1,
                background: "linear-gradient(to right,transparent,rgba(240,185,11,0.4) 20%,rgba(240,185,11,0.7))",
              }} />
              <div className="flex items-center gap-1.5 bg-[#090909] px-2.5 py-[3px] text-[11px] font-semibold"
                style={{ color: "#f0b90b", borderLeft: "2px solid #f0b90b" }}>
                <span className="opacity-50 text-[10px]">LIVE</span>
                <span className="font-mono">${formatPrice(livePrice, asset)}</span>
              </div>
            </div>
          )}

          {/* Take Profit — draggable */}
          <div
            className="absolute left-0 flex cursor-ns-resize select-none items-center"
            style={{ right: 0, top: lineY.tp, transform: "translateY(-50%)", zIndex: 12 }}
            onPointerDown={onPointerDown("takeProfit")}
          >
            <div className="flex-1" style={{
              height: dragging === "takeProfit" ? 2 : 1,
              background: "linear-gradient(to right,transparent,rgba(0,196,122,0.4) 20%,rgba(0,196,122,0.8))",
            }} />
            <div className="flex items-center gap-1 bg-[#090909] pl-2 pr-1.5 py-[3px] text-[11px] font-semibold"
              style={{ color: "#00c47a", borderLeft: "2px solid #00c47a" }}>
              <span className="opacity-50 text-[10px]">TP</span>
              <span className="font-mono">${formatPrice(levels.takeProfit, asset)}</span>
              <span className="font-mono text-[10px] opacity-70">{tpPnl >= 0 ? "+" : ""}${tpPnl.toFixed(2)}</span>
              <input
                type="number" min={1} max={100}
                value={tpQty}
                className="w-[38px] cursor-text rounded bg-[#00c47a18] px-1 py-0 text-center font-mono text-[10px] outline-none"
                style={{ color: "#00c47a", border: "1px solid #00c47a40" }}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) onTpQtyChange(Math.max(1, Math.min(100, v)));
                }}
                title="% of position to close at TP"
              />
              <span className="opacity-40 text-[9px]">%</span>
              <span className="opacity-25 text-[9px]">↕</span>
            </div>
          </div>

          {/* Stop Loss — draggable */}
          <div
            className="absolute left-0 flex cursor-ns-resize select-none items-center"
            style={{ right: 0, top: lineY.sl, transform: "translateY(-50%)", zIndex: 12 }}
            onPointerDown={onPointerDown("stopLoss")}
          >
            <div className="flex-1" style={{
              height: dragging === "stopLoss" ? 2 : 1,
              background: "linear-gradient(to right,transparent,rgba(255,59,91,0.4) 20%,rgba(255,59,91,0.8))",
            }} />
            <div className="flex items-center gap-1 bg-[#090909] pl-2 pr-1.5 py-[3px] text-[11px] font-semibold"
              style={{ color: "#ff3b5b", borderLeft: "2px solid #ff3b5b" }}>
              <span className="opacity-50 text-[10px]">SL</span>
              <span className="font-mono">${formatPrice(levels.stopLoss, asset)}</span>
              <span className="font-mono text-[10px] opacity-70">{slPnl >= 0 ? "+" : ""}${slPnl.toFixed(2)}</span>
              <input
                type="number" min={1} max={100}
                value={slQty}
                className="w-[38px] cursor-text rounded bg-[#ff3b5b18] px-1 py-0 text-center font-mono text-[10px] outline-none"
                style={{ color: "#ff3b5b", border: "1px solid #ff3b5b40" }}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) onSlQtyChange(Math.max(1, Math.min(100, v)));
                }}
                title="% of position to close at SL"
              />
              <span className="opacity-40 text-[9px]">%</span>
              <span className="opacity-25 text-[9px]">↕</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Countdown — single, top center ─────────────────────────── */}
      {windowMsRemaining > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <div
            className="flex items-center gap-2 rounded-full px-4 py-1.5"
            style={{
              background: urgency === "critical" ? "rgba(255,59,91,0.12)" : "rgba(0,0,0,0.55)",
              border: `1px solid ${timerColor}33`,
            }}
          >
            <span
              className={`font-mono text-xl font-bold tabular-nums ${urgency === "critical" ? "animate-pulse" : ""}`}
              style={{ color: timerColor }}
            >
              {fmtCountdown(windowMsRemaining)}
            </span>
            <span className="text-[10px] text-[#333]">{tfLabel}</span>
          </div>
        </div>
      )}

      {/* ── IN / OUT OF MONEY badge ──────────────────────────────────── */}
      {priceData.length > 0 && targetPrice > 0 && (
        <div className="pointer-events-none absolute right-[74px] top-3 z-20">
          <div className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-bold"
            style={{
              color:      isWinning ? "#00c47a" : "#ff3b5b",
              background: isWinning ? "rgba(0,196,122,0.08)" : "rgba(255,59,91,0.08)",
              border:     `1px solid ${isWinning ? "rgba(0,196,122,0.2)" : "rgba(255,59,91,0.15)"}`,
            }}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: isWinning ? "#00c47a" : "#ff3b5b" }} />
            {isWinning ? "IN MONEY" : "OUT MONEY"}
          </div>
        </div>
      )}

      {/* ── Market label — top left ─────────────────────────────────── */}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded border border-[#1e1e1e] bg-[#0d0d0d]/80 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-[#e2e2e2]">{asset}</span>
        <span className="text-[11px] font-medium" style={{ color: direction === "above" ? "#00c47a" : "#ff3b5b" }}>
          {direction === "above" ? "UP" : "DOWN"}
        </span>
      </div>
    </div>
  );
});
