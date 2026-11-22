"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type DeepPartial,
  type ChartOptions,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { DrawingLayer, type ChartCoords } from "@/components/markets/drawing-layer";
import { formatPrice, formatVolume, type Bar } from "@/lib/markets/bars";
import { logicalToTime, timeToLogical, type DrawTool, type Drawing } from "@/lib/markets/drawings";
import { computeIndicator, heikinAshi, heikinAshiNext, indicatorLabel, isPane, type IndicatorConfig } from "@/lib/markets/indicators";
import type { Palette } from "@/lib/markets/theme";
import { tradeLines, tradeMarks } from "@/lib/markets/trade-marks";
import type { Trade } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

export type ChartType = "candles" | "line" | "area" | "heikin";

export const CHART_TYPES: Array<{ id: ChartType; label: string; short: string }> = [
  { id: "candles", label: "Candles", short: "Candles" },
  { id: "line", label: "Line", short: "Line" },
  { id: "area", label: "Area", short: "Area" },
  { id: "heikin", label: "Heikin-Ashi", short: "HA" },
];

export interface PriceChartHandle {
  /** Replace all candles (a new market or timeframe). */
  setBars(bars: Bar[]): void;
  /** A live candle: updates the newest candle or appends one. Drawn on the next animation frame. */
  update(bar: Bar): void;
}

interface Props {
  palette: Palette;
  decimals: number;
  hasVolume: boolean;
  /** Shown in the legend, e.g. "BTC/USDT · 1h". */
  title: string;
  chartType: ChartType;
  indicators: IndicatorConfig[];
  /** Candle length in seconds (to place drawings beyond the newest candle). */
  timeframe: number;
  drawings: Drawing[];
  onDrawingsChange: (next: Drawing[]) => void;
  tool: DrawTool | null;
  onToolDone: () => void;
  /** Waiting price alerts on this market, drawn as dashed lines. */
  alertLines?: Array<{ id: string; price: number; op: "above" | "below" }>;
  /** The user's trades on this market: arrows where they opened, results where they closed, lines for open ones. */
  trades?: Trade[];
  className?: string;
}

type AnySeries = ISeriesApi<SeriesType>;
interface Overlay {
  key: string; // type + settings that need new series when changed
  series: Record<string, ISeriesApi<"Line">>;
}
interface Pane {
  key: string;
  chart: IChartApi;
  series: Record<string, AnySeries>;
  /** The line the crosshair sits on. */
  primary: string;
  lines: IPriceLine[];
}

const ts = (t: number) => t as UTCTimestamp;
const NO_TRADES: Trade[] = [];
const VISIBLE = 140;
const SCALE_WIDTH = 78;
const SIGNAL_COLOR = "#E08A3C";

function chartOptions(p: Palette): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: p.panel }, textColor: p.muted, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: p.crosshair, labelBackgroundColor: p.raised },
      horzLine: { color: p.crosshair, labelBackgroundColor: p.raised },
    },
    rightPriceScale: { borderColor: p.border, minimumWidth: SCALE_WIDTH },
    timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    kineticScroll: { touch: true, mouse: false },
  };
}

/** Settings that change which series an indicator needs (others just restyle or recompute). */
const seriesKey = (c: IndicatorConfig) => c.type;

/**
 * The Markets chart: price (candles, line, area or Heikin-Ashi) with volume, indicator overlays,
 * and RSI / MACD panes underneath that zoom, scroll and follow the crosshair together.
 */
export const PriceChart = forwardRef<PriceChartHandle, Props>(function PriceChart(
  { palette, decimals, hasVolume, title, chartType, indicators, timeframe, drawings, onDrawingsChange, tool, onToolDone, alertLines = [], trades = NO_TRADES, className },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleS = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineS = useRef<ISeriesApi<"Line"> | null>(null);
  const areaS = useRef<ISeriesApi<"Area"> | null>(null);
  const volS = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bars = useRef<Bar[]>([]);
  const ha = useRef<Bar[]>([]);
  const byTime = useRef(new Map<number, number>());
  const outputs = useRef(new Map<string, Record<string, number[]>>());
  const overlays = useRef(new Map<string, Overlay>());
  const panes = useRef(new Map<string, Pane>());
  const paneEls = useRef(new Map<string, HTMLDivElement>());
  const pending = useRef(new Map<number, Bar>());
  const frame = useRef<number | null>(null);
  const syncingRange = useRef(false);

  // Latest props for callbacks created once.
  const pal = useRef(palette);
  pal.current = palette;
  const typeRef = useRef(chartType);
  typeRef.current = chartType;
  const indRef = useRef(indicators);
  indRef.current = indicators;
  const tfRef = useRef(timeframe);
  tfRef.current = timeframe;

  /** Candle index under the crosshair (null = the newest candle). */
  const [hover, setHover] = useState<number | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const [, setTick] = useState(0); // redraws legends after data changes
  const tickFrame = useRef<number | null>(null);
  const showHover = (i: number | null) => {
    if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => setHover(i));
  };
  const refreshLegend = () => {
    if (tickFrame.current) return;
    tickFrame.current = requestAnimationFrame(() => {
      tickFrame.current = null;
      alignScales();
      setTick((t) => t + 1);
    });
  };
  /** Give every chart's price axis the same width, so the panes line up with the price chart. */
  const scaleWidth = useRef(SCALE_WIDTH);
  const alignScales = () => {
    const charts = allCharts();
    if (charts.length < 2) return;
    const widest = Math.max(SCALE_WIDTH, ...charts.map((c) => c.priceScale("right").width()));
    if (widest === scaleWidth.current) return;
    scaleWidth.current = widest;
    for (const c of charts) c.applyOptions({ rightPriceScale: { minimumWidth: widest } });
  };

  const volColor = (b: Bar) => (b.close >= b.open ? pal.current.up : pal.current.down) + "66";
  const shown = () => (typeRef.current === "heikin" ? ha.current : bars.current);

  const allCharts = () => [chart.current, ...[...panes.current.values()].map((p) => p.chart)].filter(Boolean) as IChartApi[];

  // --- price series -------------------------------------------------------

  const setMainData = () => {
    const t = typeRef.current;
    const data = shown();
    candleS.current?.setData(
      t === "candles" || t === "heikin" ? data.map((b) => ({ time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close })) : [],
    );
    lineS.current?.setData(t === "line" ? bars.current.map((b) => ({ time: ts(b.time), value: b.close })) : []);
    areaS.current?.setData(t === "area" ? bars.current.map((b) => ({ time: ts(b.time), value: b.close })) : []);
    volS.current?.setData(bars.current.map((b) => ({ time: ts(b.time), value: b.volume ?? 0, color: volColor(b) })));
  };

  const updateMainAt = (i: number) => {
    const t = typeRef.current;
    const b = bars.current[i]!;
    if (t === "candles" || t === "heikin") {
      const d = t === "heikin" ? ha.current[i]! : b;
      candleS.current?.update({ time: ts(d.time), open: d.open, high: d.high, low: d.low, close: d.close });
    } else if (t === "line") lineS.current?.update({ time: ts(b.time), value: b.close });
    else areaS.current?.update({ time: ts(b.time), value: b.close });
    volS.current?.update({ time: ts(b.time), value: b.volume ?? 0, color: volColor(b) });
  };

  // --- indicators ---------------------------------------------------------

  const point = (key: string, i: number, v: number) => {
    const time = ts(bars.current[i]!.time);
    if (!Number.isFinite(v)) return { time };
    if (key === "histogram") return { time, value: v, color: (v >= 0 ? pal.current.up : pal.current.down) + "99" };
    return { time, value: v };
  };

  const seriesOf = (id: string) => overlays.current.get(id)?.series ?? panes.current.get(id)?.series;

  /** Recompute one indicator; redraw all of it, or only from candle `from` on (live updates). */
  const writeIndicator = (c: IndicatorConfig, from?: number) => {
    const out = computeIndicator(c, bars.current);
    outputs.current.set(c.id, out);
    const series = seriesOf(c.id);
    if (!series) return;
    for (const [key, values] of Object.entries(out)) {
      const s = series[key] as AnySeries | undefined;
      if (!s) continue;
      if (from === undefined) s.setData(values.map((v, i) => point(key, i, v)) as never);
      else for (let i = from; i < values.length; i++) s.update(point(key, i, values[i]!) as never);
    }
  };

  const styleIndicator = (c: IndicatorConfig) => {
    const o = overlays.current.get(c.id);
    if (o) {
      if (c.type === "bb") {
        o.series.upper?.applyOptions({ color: c.color });
        o.series.lower?.applyOptions({ color: c.color });
        o.series.middle?.applyOptions({ color: c.color + "aa" });
      } else o.series.value?.applyOptions({ color: c.color });
    }
    const p = panes.current.get(c.id);
    if (p) {
      if (c.type === "rsi") p.series.value?.applyOptions({ color: c.color });
      if (c.type === "macd") {
        p.series.macd?.applyOptions({ color: c.color });
        p.series.signal?.applyOptions({ color: c.color.toLowerCase() === SIGNAL_COLOR.toLowerCase() ? pal.current.accent : SIGNAL_COLOR });
      }
      p.lines.forEach((l) => l.applyOptions({ color: pal.current.muted }));
    }
  };

  const addOverlay = (c: IndicatorConfig) => {
    const main = chart.current!;
    const line = (color: string, width: 1 | 2, style = LineStyle.Solid) =>
      main.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const series: Overlay["series"] =
      c.type === "bb" ? { upper: line(c.color, 1), middle: line(c.color + "aa", 1, LineStyle.Dashed), lower: line(c.color, 1) } : { value: line(c.color, 2) };
    overlays.current.set(c.id, { key: seriesKey(c), series });
  };

  const removeOverlay = (id: string) => {
    const o = overlays.current.get(id);
    if (o) for (const s of Object.values(o.series)) chart.current?.removeSeries(s);
    overlays.current.delete(id);
  };

  const onPaneRange = (src: IChartApi) => (r: LogicalRange | null) => {
    if (!r || syncingRange.current) return;
    syncingRange.current = true;
    try {
      for (const c of allCharts()) if (c !== src) c.timeScale().setVisibleLogicalRange(r);
    } finally {
      syncingRange.current = false;
    }
  };

  /** The crosshair follows the pointer across the price chart and every pane. */
  const onCross = (src: IChartApi) => (param: MouseEventParams<Time>) => {
    if (!param.point) {
      // Pointer left this chart: clear the others too.
      if (param.sourceEvent === undefined) for (const c of allCharts()) if (c !== src) c.clearCrosshairPosition();
      showHover(null);
      return;
    }
    if (!param.sourceEvent) return; // our own setCrosshairPosition echoing back
    const t = typeof param.time === "number" ? param.time : null;
    const i = t !== null ? byTime.current.get(t) : undefined;
    showHover(i ?? null);
    for (const c of allCharts()) {
      if (c === src) continue;
      if (t === null || i === undefined) {
        c.clearCrosshairPosition();
        continue;
      }
      if (c === chart.current) {
        const s = (typeRef.current === "line" ? lineS.current : typeRef.current === "area" ? areaS.current : candleS.current) as AnySeries;
        c.setCrosshairPosition(shown()[i]!.close, ts(t), s);
      } else {
        const entry = [...panes.current.entries()].find(([, p]) => p.chart === c);
        if (!entry) continue;
        const [id, p] = entry;
        const v = outputs.current.get(id)?.[p.primary]?.[i];
        if (v !== undefined && Number.isFinite(v)) c.setCrosshairPosition(v, ts(t), p.series[p.primary]!);
        else c.clearCrosshairPosition();
      }
    }
  };

  const addPane = (c: IndicatorConfig, el: HTMLDivElement) => {
    const p = pal.current;
    const pc = createChart(el, chartOptions(p));
    pc.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.12, bottom: 0.08 } } });
    const series: Pane["series"] = {};
    const lines: IPriceLine[] = [];
    let primary = "value";
    if (c.type === "rsi") {
      const s = pc.addLineSeries({
        color: c.color,
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      });
      for (const level of [70, 30])
        lines.push(s.createPriceLine({ price: level, color: p.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }));
      series.value = s;
    } else {
      primary = "macd";
      series.histogram = pc.addHistogramSeries({
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "price", precision: Math.max(2, decimals), minMove: 1 / 10 ** Math.max(2, decimals) },
      });
      series.macd = pc.addLineSeries({ color: c.color, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false });
      series.signal = pc.addLineSeries({
        color: c.color.toLowerCase() === SIGNAL_COLOR.toLowerCase() ? p.accent : SIGNAL_COLOR,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    pc.timeScale().subscribeVisibleLogicalRangeChange(onPaneRange(pc));
    pc.subscribeCrosshairMove(onCross(pc));
    const range = chart.current?.timeScale().getVisibleLogicalRange();
    panes.current.set(c.id, { key: seriesKey(c), chart: pc, series, primary, lines });
    writeIndicator(c);
    if (range) pc.timeScale().setVisibleLogicalRange(range);
  };

  const removePane = (id: string) => {
    panes.current.get(id)?.chart.remove();
    panes.current.delete(id);
  };

  /** Bring overlays and panes in line with the indicator list. */
  const syncIndicators = () => {
    if (!chart.current) return;
    const list = indRef.current;
    const ids = new Set(list.map((c) => c.id));
    for (const [id, o] of overlays.current) {
      const c = list.find((x) => x.id === id);
      if (!c || isPane(c) || o.key !== seriesKey(c)) removeOverlay(id);
    }
    for (const [id, p] of panes.current) {
      const c = list.find((x) => x.id === id);
      if (!c || !isPane(c) || p.key !== seriesKey(c) || paneEls.current.get(id) === undefined) removePane(id);
    }
    for (const id of outputs.current.keys()) if (!ids.has(id)) outputs.current.delete(id);
    for (const c of list) {
      if (isPane(c)) {
        const el = paneEls.current.get(c.id);
        if (!panes.current.has(c.id) && el) addPane(c, el);
      } else if (!overlays.current.has(c.id)) addOverlay(c);
      styleIndicator(c);
      writeIndicator(c);
    }
    scaleWidth.current = 0; // re-measure
    for (const c of allCharts()) c.applyOptions({ rightPriceScale: { minimumWidth: SCALE_WIDTH } });
    // Only the bottom chart shows the time axis.
    const paneList = list
      .filter(isPane)
      .map((c) => panes.current.get(c.id))
      .filter(Boolean) as Pane[];
    chart.current.applyOptions({ timeScale: { visible: paneList.length === 0 } });
    paneList.forEach((p, i) => p.chart.applyOptions({ timeScale: { visible: i === paneList.length - 1 } }));
    refreshLegend();
  };

  // --- lifecycle ------------------------------------------------------------

  useEffect(() => {
    const p = pal.current;
    const c = createChart(box.current!, chartOptions(p));
    c.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.24 } } });
    candleS.current = c.addCandlestickSeries({
      upColor: p.up,
      downColor: p.down,
      borderUpColor: p.up,
      borderDownColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      priceLineColor: p.accent,
    });
    lineS.current = c.addLineSeries({ color: p.accent, lineWidth: 2, priceLineColor: p.accent });
    areaS.current = c.addAreaSeries({ lineColor: p.accent, topColor: p.accent + "55", bottomColor: p.accent + "05", lineWidth: 2, priceLineColor: p.accent });
    volS.current = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    c.timeScale().subscribeVisibleLogicalRangeChange(onPaneRange(c));
    c.subscribeCrosshairMove(onCross(c));
    chart.current = c;
    const paneMap = panes.current;
    const overlayMap = overlays.current;
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
      if (tickFrame.current) cancelAnimationFrame(tickFrame.current);
      for (const pane of paneMap.values()) pane.chart.remove();
      paneMap.clear();
      overlayMap.clear();
      c.remove();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme.
  useEffect(() => {
    for (const c of allCharts()) c.applyOptions({ ...chartOptions(palette), autoSize: true });
    candleS.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceLineColor: palette.accent,
    });
    lineS.current?.applyOptions({ color: palette.accent, priceLineColor: palette.accent });
    areaS.current?.applyOptions({
      lineColor: palette.accent,
      topColor: palette.accent + "55",
      bottomColor: palette.accent + "05",
      priceLineColor: palette.accent,
    });
    setMainData();
    syncIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  // Chart type.
  useEffect(() => {
    const candles = chartType === "candles" || chartType === "heikin";
    candleS.current?.applyOptions({ visible: candles });
    lineS.current?.applyOptions({ visible: chartType === "line" });
    areaS.current?.applyOptions({ visible: chartType === "area" });
    setMainData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // Price precision and whether there is volume to show.
  useEffect(() => {
    const priceFormat = { type: "price" as const, precision: decimals, minMove: 1 / 10 ** decimals };
    candleS.current?.applyOptions({ priceFormat });
    lineS.current?.applyOptions({ priceFormat });
    areaS.current?.applyOptions({ priceFormat });
    for (const o of overlays.current.values()) for (const s of Object.values(o.series)) s.applyOptions({ priceFormat });
    const paneFormat = { type: "price" as const, precision: Math.max(2, decimals), minMove: 1 / 10 ** Math.max(2, decimals) };
    for (const p of panes.current.values()) for (const k of ["histogram", "macd", "signal"]) p.series[k]?.applyOptions({ priceFormat: paneFormat });
    volS.current?.applyOptions({ visible: hasVolume });
    chart.current?.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.08, bottom: hasVolume ? 0.24 : 0.06 } } });
  }, [decimals, hasVolume]);

  // Price alert lines on whichever series is showing.
  // The user's trades: markers on the price series, and entry / stop / target lines for open ones.
  const tradesRef = useRef(trades);
  tradesRef.current = trades;
  const tradePriceLines = useRef<Array<{ series: AnySeries; line: IPriceLine }>>([]);
  const applyTrades = () => {
    for (const { series, line } of tradePriceLines.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // series already gone
      }
    }
    tradePriceLines.current = [];
    for (const s of [candleS.current, lineS.current, areaS.current]) s?.setMarkers([]);
    const t = typeRef.current;
    const series = (t === "line" ? lineS.current : t === "area" ? areaS.current : candleS.current) as AnySeries | null;
    if (!series || !bars.current.length || !tradesRef.current.length) return;
    const p = pal.current;
    const marks = tradeMarks(tradesRef.current, tfRef.current, new Set(bars.current.map((b) => b.time)));
    series.setMarkers(
      marks.map((m) => ({
        time: ts(m.time),
        position: (m.kind === "open") === (m.side === "buy") ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.kind === "open" ? (m.side === "buy" ? p.up : p.down) : m.won ? p.up : p.down,
        shape: m.kind === "open" ? (m.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const)) : ("circle" as const),
        text: m.text,
      })),
    );
    for (const l of tradeLines(tradesRef.current)) {
      const line = series.createPriceLine({
        price: l.price,
        color: l.kind === "entry" ? p.text : l.kind === "stop" ? p.down : p.up,
        lineWidth: 1,
        lineStyle: l.kind === "entry" ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.title,
      });
      tradePriceLines.current.push({ series, line });
    }
  };
  const tradesKey = trades.map((t) => `${t.id}:${t.status}:${t.pnl.toFixed(2)}:${t.sl}:${t.tp}:${t.entry_price}`).join("|");
  useEffect(() => {
    applyTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradesKey, chartType, palette, timeframe]);

  const alertPriceLines = useRef<Array<{ series: AnySeries; line: IPriceLine }>>([]);
  const alertKey = alertLines.map((a) => `${a.id}:${a.price}:${a.op}`).join("|");
  useEffect(() => {
    for (const { series, line } of alertPriceLines.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // series already gone
      }
    }
    alertPriceLines.current = [];
    const series = (chartType === "line" ? lineS.current : chartType === "area" ? areaS.current : candleS.current) as AnySeries | null;
    if (!series) return;
    for (const a of alertLines) {
      const line = series.createPriceLine({
        price: a.price,
        color: palette.accent,
        lineWidth: 1,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: a.op === "above" ? "Alert ▲" : "Alert ▼",
      });
      alertPriceLines.current.push({ series, line });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey, chartType, palette]);

  // Indicators (after the pane containers for new panes are in the DOM).
  useEffect(() => {
    syncIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators]);

  // --- data in ----------------------------------------------------------------

  const flush = () => {
    frame.current = null;
    const updates = [...pending.current.values()].sort((a, b) => a.time - b.time);
    pending.current.clear();
    let from = Infinity;
    for (const b of updates) {
      const n = bars.current.length;
      const last = bars.current[n - 1];
      if (last && b.time < last.time) {
        // A correction to an older candle (after a reconnect): keep our copy right.
        const i = byTime.current.get(b.time);
        if (i !== undefined) bars.current[i] = b;
        continue;
      }
      let i: number;
      if (last && b.time === last.time) {
        i = n - 1;
        bars.current[i] = b;
      } else {
        i = n;
        byTime.current.set(b.time, i);
        bars.current.push(b);
      }
      ha.current[i] = heikinAshiNext(ha.current[i - 1], b);
      from = Math.min(from, i);
      updateMainAt(i);
    }
    if (from === Infinity) return;
    for (const c of indRef.current) writeIndicator(c, from);
    refreshLegend();
  };

  useImperativeHandle(
    ref,
    () => ({
      setBars(next: Bar[]) {
        pending.current.clear();
        bars.current = next.map((b) => ({ ...b }));
        ha.current = heikinAshi(bars.current);
        byTime.current = new Map(bars.current.map((b, i) => [b.time, i]));
        setMainData();
        for (const c of indRef.current) writeIndicator(c);
        const n = bars.current.length;
        if (n) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE), to: n + 4 });
        setHover(null);
        applyTrades();
        refreshLegend();
      },
      update(bar: Bar) {
        pending.current.set(bar.time, bar);
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // --- drawings --------------------------------------------------------------------

  const coords = useMemo<ChartCoords>(() => {
    const active = () => (typeRef.current === "line" ? lineS.current : typeRef.current === "area" ? areaS.current : candleS.current) as AnySeries | null;
    const times = () => bars.current.map((b) => b.time);
    return {
      pane: () => {
        const c = chart.current;
        if (!c || !bars.current.length) return null;
        const size = c.paneSize();
        return size.width > 0 && size.height > 0 ? size : null;
      },
      timeToX: (t) => chart.current?.timeScale().logicalToCoordinate(timeToLogical(times(), t, tfRef.current) as never) ?? null,
      priceToY: (p) => active()?.priceToCoordinate(p) ?? null,
      xToLogical: (x) => {
        const l = chart.current?.timeScale().coordinateToLogical(x);
        return l === null || l === undefined ? null : Number(l);
      },
      logicalToTime: (l) => logicalToTime(times(), l, tfRef.current),
      timeToLogical: (t) => timeToLogical(times(), t, tfRef.current),
      yToPrice: (y) => active()?.coordinateToPrice(y) ?? null,
    };
  }, []);

  // --- legends ------------------------------------------------------------------

  const idx = hover ?? bars.current.length - 1;
  const b = bars.current[idx];
  const prev = bars.current[idx - 1];
  const change = b && prev ? ((b.close - prev.close) / prev.close) * 100 : null;
  const tone = b ? (b.close >= b.open ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]") : "";
  const val = (id: string, key: string, d = decimals) => {
    const v = outputs.current.get(id)?.[key]?.[idx];
    return v === undefined || !Number.isFinite(v) ? "—" : formatPrice(v, d);
  };
  const overlayList = indicators.filter((c) => !isPane(c));
  const paneList = indicators.filter(isPane);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative min-h-[140px] flex-1">
        <div ref={box} className="absolute inset-0" />
        <DrawingLayer
          coords={coords}
          drawings={drawings}
          onChange={onDrawingsChange}
          tool={tool}
          onToolDone={onToolDone}
          palette={palette}
          decimals={decimals}
        />
        <div
          data-legend="main"
          className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex max-w-[calc(100%-5.5rem)] flex-col gap-0.5 rounded-lg px-1.5 py-0.5 font-mono text-[10px] text-[var(--mk-muted)] sm:left-2 sm:top-2 sm:py-1 sm:text-xs"
          style={{ background: `${palette.panel}d9` }}
        >
          <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-2.5">
            <span className="hidden font-sans font-semibold text-[var(--mk-text)] sm:inline">
              {title}
              {chartType === "heikin" && <span className="font-normal text-[var(--mk-muted)]"> · Heikin-Ashi</span>}
            </span>
            {b && (
              <>
                <span>
                  O <span className={tone}>{formatPrice(b.open, decimals)}</span>
                </span>
                <span>
                  H <span className={tone}>{formatPrice(b.high, decimals)}</span>
                </span>
                <span>
                  L <span className={tone}>{formatPrice(b.low, decimals)}</span>
                </span>
                <span>
                  C <span className={tone}>{formatPrice(b.close, decimals)}</span>
                </span>
                {change !== null && (
                  <span className={tone}>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}%
                  </span>
                )}
                {hasVolume && (
                  <span>
                    V <span className="text-[var(--mk-text)]">{formatVolume(b.volume)}</span>
                  </span>
                )}
              </>
            )}
          </div>
          {overlayList.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2.5">
              {overlayList.map((c) => (
                <span key={c.id} className="whitespace-nowrap">
                  <span style={{ color: c.color }}>{indicatorLabel(c)}</span>{" "}
                  {c.type === "bb" ? (
                    <span className="text-[var(--mk-text)]">
                      {val(c.id, "upper")} / {val(c.id, "lower")}
                    </span>
                  ) : (
                    <span className="text-[var(--mk-text)]">{val(c.id, "value")}</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {paneList.map((c) => (
        <div key={c.id} className="relative h-[92px] shrink-0 border-t border-[var(--mk-border)] sm:h-[118px]">
          <div
            className="absolute inset-0"
            ref={(el) => {
              if (el) paneEls.current.set(c.id, el);
              else paneEls.current.delete(c.id);
            }}
          />
          <div
            data-legend={c.type}
            className="pointer-events-none absolute left-1.5 top-1 z-10 rounded px-1 font-mono text-[10px] text-[var(--mk-muted)] sm:left-2 sm:text-xs"
            style={{ background: `${palette.panel}d9` }}
          >
            <span style={{ color: c.color }}>{indicatorLabel(c)}</span>{" "}
            {c.type === "rsi" ? (
              <span className="text-[var(--mk-text)]">{val(c.id, "value", 2)}</span>
            ) : (
              <>
                <span className="text-[var(--mk-text)]">{val(c.id, "macd")}</span> <span style={{ color: SIGNAL_COLOR }}>{val(c.id, "signal")}</span>{" "}
                <span className="text-[var(--mk-text)]">{val(c.id, "histogram")}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
});
