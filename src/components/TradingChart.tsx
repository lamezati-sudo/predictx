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
  BaselineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  LineType,
} from "lightweight-charts";
import type { Asset, Candle, Direction, ProbLevels, Timeframe } from "@/types";
import { formatPrice } from "@/types";
import type { ProbPoint } from "@/lib/window-prob";
import { useGameStore } from "@/store/game-store";

export interface TradingChartHandle {
  updateLivePrice: (price: number) => void;
  updateLiveProb:  (prob: number, timeSeconds: number) => void;
}

type ChartView = "prob" | "btc";
type DraggableKind = "stopLoss" | "takeProfit";

interface Props {
  asset:             Asset;
  timeframe:         Timeframe;
  candles:           Candle[];
  probData:          ProbPoint[];
  currentPrice:      number;
  targetPrice:       number;
  windowStartSec:    number;
  windowEndSec:      number;
  windowMsRemaining: number;
  levels:            ProbLevels | null;
  direction:         Direction;
  tpQty:             number;
  slQty:             number;
  onLevelsChange:    (levels: ProbLevels) => void;
  onLevelsCommit?:   (levels: ProbLevels) => void;
  onTpQtyChange:     (qty: number) => void;
  onSlQtyChange:     (qty: number) => void;
}

function fmtCountdown(ms: number) {
  if (ms <= 0) return "0:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TradingChart = forwardRef<TradingChartHandle, Props>(function TradingChart({
  asset, timeframe, candles, probData, currentPrice, targetPrice,
  windowStartSec, windowEndSec,
  windowMsRemaining, levels, direction,
  tpQty, slQty, onLevelsChange, onLevelsCommit, onTpQtyChange, onSlQtyChange,
}, ref) {
  // Contract count — how many $1-face-value contracts the current stake buys
  const stake       = useGameStore((s) => s.stake);
  const storeProb   = useGameStore((s) => s.currentProb);
  const maxContracts = Math.max(1, Math.round(stake / Math.max(0.01, storeProb)));
  // Convert stored % (1–100) ↔ contract count for display
  const tpContracts = Math.max(1, Math.round(tpQty / 100 * maxContracts));
  const slContracts = Math.max(1, Math.round(slQty / 100 * maxContracts));

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef   = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const btcSeriesRef  = useRef<ISeriesApi<"Area"> | null>(null);
  const probSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);

  const [view,    setView]    = useState<ChartView>("prob");
  const [dragging, setDragging] = useState<DraggableKind | null>(null);
  const [lineY,   setLineY]   = useState({ tp: 0, sl: 0, mid: 0, entry: 0 });

  const viewRef               = useRef<ChartView>("prob");
  const latestCandleTimeRef   = useRef<number>(0);
  const levelsRef             = useRef(levels);
  const currentPriceRef       = useRef(currentPrice);
  const targetPriceRef        = useRef(targetPrice);
  const currentProbRef        = useRef(0.5);
  const latestProbTimeRef     = useRef<number>(0);
  const probDataLenRef        = useRef(0);
  const windowRangeRef        = useRef({ start: 0, end: 0 });

  levelsRef.current       = levels;
  currentPriceRef.current = currentPrice;
  targetPriceRef.current  = targetPrice;
  viewRef.current         = view;

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

  // ─── Sync overlay Y positions ─────────────────────────────────────────
  const updatePositions = useCallback(() => {
    const lvls   = levelsRef.current;
    const vw     = viewRef.current;
    if (!lvls) return;

    if (vw === "prob") {
      const series = probSeriesRef.current;
      if (!series) return;
      const tpY  = series.priceToCoordinate(lvls.takeProfit * 100);
      const slY  = series.priceToCoordinate(lvls.stopLoss * 100);
      const midY = series.priceToCoordinate(50);
      const entY = series.priceToCoordinate(currentProbRef.current * 100);
      if (tpY != null && slY != null && midY != null && entY != null) {
        setLineY({ tp: tpY, sl: slY, mid: midY, entry: entY });
      }
    } else {
      const series = btcSeriesRef.current;
      if (!series) return;
      const tpAsPrice = targetPriceRef.current * (1 + (lvls.takeProfit - 0.5) * 0.01);
      const slAsPrice = targetPriceRef.current * (1 + (lvls.stopLoss   - 0.5) * 0.01);
      const tpY = series.priceToCoordinate(tpAsPrice);
      const slY = series.priceToCoordinate(slAsPrice);
      const midY = targetPriceRef.current > 0 ? series.priceToCoordinate(targetPriceRef.current) : null;
      const entY = series.priceToCoordinate(currentPriceRef.current);
      if (tpY != null && slY != null && midY != null && entY != null) {
        setLineY({ tp: tpY, sl: slY, mid: midY, entry: entY });
      }
    }
  }, []);

  // ─── Imperative handle ─────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    updateLivePrice: (price: number) => {
      const t = latestCandleTimeRef.current;
      if (t === 0) return;
      currentPriceRef.current = price;
      const btcSeries = btcSeriesRef.current;
      if (btcSeries) btcSeries.update({ time: t as Time, value: price });
      requestAnimationFrame(updatePositions);
    },
    updateLiveProb: (_prob: number, _timeSeconds: number) => {
      // Chart prob series is driven only by probData (worker feed) to avoid
      // out-of-order lightweight-charts updates. LIVE overlay uses storeProb.
    },
  }), [updatePositions]);

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

    // BTC price series
    const btcSeries = chart.addSeries(AreaSeries, {
      lineColor:   "#e2e2e2",
      lineWidth:   2,
      lineType:    LineType.Simple,
      topColor:    "rgba(226,226,226,0.07)",
      bottomColor: "rgba(0,0,0,0)",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Probability baseline series (0–100, baseline at 50)
    // autoscaleInfoProvider pins the Y axis to 0–100 so overlay coordinates
    // are always valid even before data arrives or after a page refresh.
    const probSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 50 },
      topLineColor:    "#00c47a",
      topFillColor1:   "rgba(0,196,122,0.18)",
      topFillColor2:   "rgba(0,196,122,0.02)",
      bottomLineColor: "#ff3b5b",
      bottomFillColor1: "rgba(0,0,0,0)",
      bottomFillColor2: "rgba(255,59,91,0.14)",
      lineWidth:   2,
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: 0, maxValue: 100 },
        margins: { above: 0.08, below: 0.08 },
      }),
    });

    btcSeriesRef.current  = btcSeries;
    probSeriesRef.current = probSeries;
    chartRef.current      = chart;

    // Show the correct series for initial view
    btcSeries.applyOptions({ visible: false });
    probSeries.applyOptions({ visible: true });

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
      chartRef.current  = null;
      btcSeriesRef.current  = null;
      probSeriesRef.current = null;
    };
  }, [updatePositions]);

  // ─── Toggle view ───────────────────────────────────────────────────────
  useEffect(() => {
    btcSeriesRef.current?.applyOptions({ visible: view === "btc" });
    probSeriesRef.current?.applyOptions({ visible: view === "prob" });
    applyWindowRange();
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [view, updatePositions, applyWindowRange]);

  // ─── Lock X-axis to full wall-clock window ─────────────────────────────
  useEffect(() => {
    const changed =
      windowRangeRef.current.start !== windowStartSec ||
      windowRangeRef.current.end !== windowEndSec;
    if (changed) {
      windowRangeRef.current = { start: windowStartSec, end: windowEndSec };
      probDataLenRef.current = 0;
      latestProbTimeRef.current = 0;
      probSeriesRef.current?.setData([]);
      btcSeriesRef.current?.setData([]);
    }
    applyWindowRange();
  }, [windowStartSec, windowEndSec, applyWindowRange]);

  // ─── Feed BTC candles ──────────────────────────────────────────────────
  useEffect(() => {
    const series = btcSeriesRef.current;
    if (!series) return;
    if (candles.length === 0) { series.setData([]); return; }

    const first = candles[0].close;
    const last  = candles[candles.length - 1].close;
    const up    = last >= first;
    series.applyOptions({
      lineColor:   up ? "#00c47a" : "#ff3b5b",
      topColor:    up ? "rgba(0,196,122,0.12)" : "rgba(255,59,91,0.10)",
      bottomColor: "rgba(0,0,0,0)",
    });
    series.setData(candles.map((c) => ({ time: c.time as Time, value: c.close })));
    latestCandleTimeRef.current = candles[candles.length - 1].time;
    applyWindowRange();
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [candles, updatePositions, applyWindowRange]);

  // ─── Feed probability data (setData only — preserves frozen history) ───
  useEffect(() => {
    const series = probSeriesRef.current;
    if (!series) return;

    if (probData.length === 0) {
      if (probDataLenRef.current !== 0) {
        series.setData([]);
        probDataLenRef.current = 0;
        latestProbTimeRef.current = 0;
      }
      return;
    }

    const points = probData.map((p) => ({ time: p.time as Time, value: p.value }));
    series.setData(points);
    probDataLenRef.current = probData.length;
    latestProbTimeRef.current = probData[probData.length - 1].time;
    currentProbRef.current = probData[probData.length - 1].value / 100;
    applyWindowRange();
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [probData, updatePositions, applyWindowRange]);

  // ─── Update currentProb ref and positions on prob data change ──────────
  useEffect(() => {
    if (probData.length > 0) {
      currentProbRef.current = probData[probData.length - 1].value / 100;
      requestAnimationFrame(updatePositions);
    }
  }, [probData, updatePositions]);

  // Smooth LIVE overlay between worker ticks (chart series stays 1Hz from feed)
  useEffect(() => {
    if (storeProb > 0) {
      currentProbRef.current = storeProb;
      requestAnimationFrame(updatePositions);
    }
  }, [storeProb, updatePositions]);

  // ─── Live price / levels update ────────────────────────────────────────
  useEffect(() => {
    const series = btcSeriesRef.current;
    if (!series || currentPrice <= 0 || candles.length === 0) return;
    const last = candles[candles.length - 1];
    latestCandleTimeRef.current = last.time;
    series.update({ time: last.time as Time, value: currentPrice });
    const up = currentPrice >= (candles[0]?.close ?? currentPrice);
    series.applyOptions({
      lineColor:   up ? "#00c47a" : "#ff3b5b",
      topColor:    up ? "rgba(0,196,122,0.12)" : "rgba(255,59,91,0.10)",
    });
    requestAnimationFrame(updatePositions);
  }, [currentPrice, candles, updatePositions]);

  useEffect(() => {
    // Update on every levels/targetPrice change (covers initial load + drag)
    requestAnimationFrame(() => requestAnimationFrame(updatePositions));
  }, [levels, targetPrice, updatePositions]);

  // ─── Drag handlers ────────────────────────────────────────────────────
  const probFromY = useCallback((clientY: number): number | null => {
    const rect = overlayRef.current?.getBoundingClientRect();
    const vw   = viewRef.current;
    if (!rect) return null;
    const y = clientY - rect.top;
    if (vw === "prob") {
      const v = probSeriesRef.current?.coordinateToPrice(y);
      return v != null ? Math.max(0, Math.min(100, v)) / 100 : null;
    }
    return null;
  }, []);

  const onPointerDown = (kind: DraggableKind) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(kind);
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !levelsRef.current || viewRef.current !== "prob") return;
    const val = probFromY(e.clientY);
    if (val == null) return;
    const next = { ...levelsRef.current };
    if (dragging === "takeProfit" && val > levelsRef.current.entry + 0.01 && val <= 0.99) {
      next.takeProfit = val;
    }
    if (dragging === "stopLoss" && val < levelsRef.current.entry - 0.01 && val >= 0.01) {
      next.stopLoss = val;
    }
    onLevelsChange(next);
  }, [dragging, probFromY, onLevelsChange]);

  const stopDrag = () => {
    if (dragging && levelsRef.current && onLevelsCommit) {
      onLevelsCommit(levelsRef.current);
    }
    setDragging(null);
  };

  // ─── Derived ──────────────────────────────────────────────────────────
  const currentProb = storeProb > 0
    ? storeProb * 100
    : probData.length > 0
      ? probData[probData.length - 1].value
      : 50;
  const isWinning   = direction === "above" ? currentProb > 50 : currentProb < 50;
  const urgency     = windowMsRemaining < 30_000  ? "critical"
                    : windowMsRemaining < 120_000 ? "warning"
                    : "normal";
  const timerColor  = urgency === "critical" ? "#ff3b5b"
                    : urgency === "warning"  ? "#f0b90b"
                    : "#666";

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── Prob + BTC overlay ──────────────────────────────────────── */}
      {levels && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10"
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
        >
          {view === "prob" && (
            <>
              {/* Midline at 50 */}
              <div className="pointer-events-none absolute left-0" style={{
                right: 66, top: lineY.mid, transform: "translateY(-50%)",
              }}>
                <div style={{
                  height: 1,
                  background: "repeating-linear-gradient(to right,#333 0px,#333 6px,transparent 6px,transparent 12px)",
                }} />
              </div>

              {/* Current prob (entry line — live, not draggable) */}
              <div className="pointer-events-none absolute left-0 flex items-center" style={{
                right: 0, top: lineY.entry, transform: "translateY(-50%)", zIndex: 8,
              }}>
                <div className="flex-1" style={{
                  height: 1,
                  background: "linear-gradient(to right,transparent,rgba(240,185,11,0.4) 20%,rgba(240,185,11,0.7))",
                }} />
                <div className="flex items-center gap-1.5 bg-[#090909] px-2.5 py-[3px] text-[11px] font-semibold"
                  style={{ color: "#f0b90b", borderLeft: "2px solid #f0b90b" }}>
                  <span className="opacity-50 text-[10px]">LIVE</span>
                  <span className="font-mono">{currentProb.toFixed(1)}¢</span>
                </div>
              </div>

              {/* Take Profit line — draggable */}
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
                  <span className="font-mono">{Math.round(levels.takeProfit * 100)}¢</span>
                  <input
                    type="number" min={1} max={maxContracts}
                    value={tpContracts}
                    className="w-[42px] cursor-text rounded bg-[#00c47a18] px-1 py-0 text-center font-mono text-[10px] outline-none"
                    style={{ color: "#00c47a", border: "1px solid #00c47a40" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1) {
                        onTpQtyChange(Math.min(100, Math.round(v / maxContracts * 100)));
                      }
                    }}
                    title={`Contracts to sell at TP (max ${maxContracts})`}
                  />
                  <span className="opacity-40 text-[9px]">cts</span>
                  <span className="opacity-25 text-[9px]">↕</span>
                </div>
              </div>

              {/* Stop Loss line — draggable */}
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
                  <span className="font-mono">{Math.round(levels.stopLoss * 100)}¢</span>
                  <input
                    type="number" min={1} max={maxContracts}
                    value={slContracts}
                    className="w-[42px] cursor-text rounded bg-[#ff3b5b18] px-1 py-0 text-center font-mono text-[10px] outline-none"
                    style={{ color: "#ff3b5b", border: "1px solid #ff3b5b40" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1) {
                        onSlQtyChange(Math.min(100, Math.round(v / maxContracts * 100)));
                      }
                    }}
                    title={`Contracts to sell at SL (max ${maxContracts})`}
                  />
                  <span className="opacity-40 text-[9px]">cts</span>
                  <span className="opacity-25 text-[9px]">↕</span>
                </div>
              </div>
            </>
          )}

          {view === "btc" && targetPrice > 0 && (
            /* Target price reference line on BTC view */
            <div className="pointer-events-none absolute left-0 flex items-center" style={{
              right: 0, top: lineY.mid, transform: "translateY(-50%)",
            }}>
              <div className="flex-1" style={{
                height: 1,
                background: "repeating-linear-gradient(to right,rgba(255,255,255,0.4) 0,rgba(255,255,255,0.4) 6px,transparent 6px,transparent 12px)",
              }} />
              <div className="flex items-center gap-1.5 bg-[#090909] px-2.5 py-[3px] text-[11px]"
                style={{ color: "#888", borderLeft: "1px solid #333" }}>
                <span className="opacity-50 text-[10px]">TARGET</span>
                <span className="font-mono text-white">${formatPrice(targetPrice, asset)}</span>
              </div>
            </div>
          )}
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
            <span className="text-[10px] text-[#333]">
              {timeframe === "15m" ? "15 min" : timeframe === "1h" ? "1 hr" : "2 hr"}
            </span>
          </div>
        </div>
      )}

      {/* ── IN / OUT OF MONEY badge ──────────────────────────────────── */}
      {probData.length > 0 && (
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

      {/* ── View toggle button — top left ───────────────────────────── */}
      <div className="absolute left-3 top-3 z-20 flex overflow-hidden rounded border border-[#1e1e1e]">
        <button
          onClick={() => setView("prob")}
          className="px-3 py-1.5 text-[11px] font-semibold transition-all"
          style={{
            background: view === "prob" ? "#1a1a1a" : "transparent",
            color:      view === "prob" ? "#e2e2e2" : "#3a3a3a",
          }}
        >
          PREDICTION
        </button>
        <button
          onClick={() => setView("btc")}
          className="px-3 py-1.5 text-[11px] font-semibold transition-all"
          style={{
            background: view === "btc" ? "#1a1a1a" : "transparent",
            color:      view === "btc" ? "#f7931a" : "#3a3a3a",
          }}
        >
          {asset} PRICE
        </button>
      </div>

      {/* ── Prob chart Y-axis hint ───────────────────────────────────── */}
      {view === "prob" && (
        <div className="pointer-events-none absolute bottom-8 left-3 z-10 space-y-0.5">
          <div className="font-mono text-[9px] text-[#2a2a2a]">100¢ = certain {direction.toUpperCase()}</div>
          <div className="font-mono text-[9px] text-[#2a2a2a]">50¢ = 50/50</div>
          <div className="font-mono text-[9px] text-[#2a2a2a]">0¢ = certain {direction === "above" ? "BELOW" : "ABOVE"}</div>
        </div>
      )}
    </div>
  );
});
