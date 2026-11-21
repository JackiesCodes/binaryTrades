"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { formatPrice, formatVolume, type Bar } from "@/lib/markets/bars";
import type { Palette } from "@/lib/markets/theme";
import { cn } from "@/lib/utils";

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
  className?: string;
}

const ts = (t: number) => t as UTCTimestamp;
const VISIBLE = 140;

/** Candlestick chart with volume underneath and an OHLCV legend that follows the crosshair. */
export const PriceChart = forwardRef<PriceChartHandle, Props>(function PriceChart({ palette, decimals, hasVolume, title, className }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const bars = useRef<Bar[]>([]);
  const byTime = useRef(new Map<number, number>()); // time → index in bars
  const pending = useRef(new Map<number, Bar>());
  const frame = useRef<number | null>(null);
  const hovering = useRef(false);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const [legend, setLegend] = useState<{ bar: Bar; prev: Bar | null } | null>(null);
  const legendFrame = useRef<number | null>(null);

  const volColor = (b: Bar) => (b.close >= b.open ? paletteRef.current.up : paletteRef.current.down) + "66";

  const showLegend = (i: number) => {
    const bar = bars.current[i];
    if (!bar) return;
    const next = { bar, prev: bars.current[i - 1] ?? null };
    if (legendFrame.current) cancelAnimationFrame(legendFrame.current);
    legendFrame.current = requestAnimationFrame(() => setLegend(next));
  };

  // Create once; dispose on unmount.
  useEffect(() => {
    const el = box.current!;
    const p = paletteRef.current;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: p.panel }, textColor: p.muted, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: p.crosshair, labelBackgroundColor: p.raised },
        horzLine: { color: p.crosshair, labelBackgroundColor: p.raised },
      },
      rightPriceScale: { borderColor: p.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: p.border, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      kineticScroll: { touch: true, mouse: false },
    });
    const cs = c.addCandlestickSeries({
      upColor: p.up,
      downColor: p.down,
      borderUpColor: p.up,
      borderDownColor: p.down,
      wickUpColor: p.up,
      wickDownColor: p.down,
      priceLineColor: p.accent,
    });
    const vs = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    candles.current = cs;
    volume.current = vs;

    const onMove = (param: MouseEventParams<Time>) => {
      const t = typeof param.time === "number" ? param.time : null;
      const i = t !== null ? byTime.current.get(t) : undefined;
      hovering.current = i !== undefined;
      showLegend(i ?? bars.current.length - 1);
    };
    c.subscribeCrosshairMove(onMove);
    return () => {
      c.unsubscribeCrosshairMove(onMove);
      if (frame.current) cancelAnimationFrame(frame.current);
      if (legendFrame.current) cancelAnimationFrame(legendFrame.current);
      c.remove();
      chart.current = null;
      candles.current = null;
      volume.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: palette.panel }, textColor: palette.muted },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      crosshair: { vertLine: { color: palette.crosshair, labelBackgroundColor: palette.raised }, horzLine: { color: palette.crosshair, labelBackgroundColor: palette.raised } },
      rightPriceScale: { borderColor: palette.border },
      timeScale: { borderColor: palette.border },
    });
    candles.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      priceLineColor: palette.accent,
    });
    volume.current?.setData(bars.current.map((b) => ({ time: ts(b.time), value: b.volume ?? 0, color: volColor(b) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  // Price precision and whether there is volume to show.
  useEffect(() => {
    candles.current?.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 1 / 10 ** decimals } });
    volume.current?.applyOptions({ visible: hasVolume });
    chart.current?.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.08, bottom: hasVolume ? 0.24 : 0.06 } } });
  }, [decimals, hasVolume]);

  const flush = () => {
    frame.current = null;
    const cs = candles.current;
    const vs = volume.current;
    if (!cs || !vs) return;
    const updates = [...pending.current.values()].sort((a, b) => a.time - b.time);
    pending.current.clear();
    for (const b of updates) {
      const last = bars.current[bars.current.length - 1];
      if (last && b.time < last.time) {
        // A correction to an older candle (after a reconnect): update our copy only.
        const i = byTime.current.get(b.time);
        if (i !== undefined) bars.current[i] = b;
        continue;
      }
      if (last && b.time === last.time) bars.current[bars.current.length - 1] = b;
      else {
        byTime.current.set(b.time, bars.current.length);
        bars.current.push(b);
      }
      cs.update({ time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close });
      vs.update({ time: ts(b.time), value: b.volume ?? 0, color: volColor(b) });
    }
    if (!hovering.current) showLegend(bars.current.length - 1);
  };

  useImperativeHandle(ref, () => ({
    setBars(next: Bar[]) {
      pending.current.clear();
      bars.current = next.map((b) => ({ ...b }));
      byTime.current = new Map(bars.current.map((b, i) => [b.time, i]));
      candles.current?.setData(bars.current.map((b) => ({ time: ts(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
      volume.current?.setData(bars.current.map((b) => ({ time: ts(b.time), value: b.volume ?? 0, color: volColor(b) })));
      const n = bars.current.length;
      if (n) chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE), to: n + 4 });
      hovering.current = false;
      showLegend(n - 1);
      if (!n) setLegend(null);
    },
    update(bar: Bar) {
      pending.current.set(bar.time, bar);
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const b = legend?.bar;
  const change = b && legend.prev ? ((b.close - legend.prev.close) / legend.prev.close) * 100 : null;
  const tone = b ? (b.close >= b.open ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]") : "";

  return (
    <div className={cn("relative min-h-0", className)}>
      <div ref={box} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-x-2 gap-y-0 rounded-lg px-1.5 py-0.5 font-mono text-[10px] sm:left-2 sm:top-2 sm:gap-x-2.5 sm:py-1 sm:text-xs text-[var(--mk-muted)] sm:text-xs" style={{ background: `${palette.panel}d9` }}>
        <span className="hidden font-sans font-semibold text-[var(--mk-text)] sm:inline">{title}</span>
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
    </div>
  );
});
