// Indicator maths for the Markets chart. Pure functions over candles; every output array is
// aligned with the input (one value per candle, NaN where the indicator has no value yet).

import type { Bar } from "@/lib/markets/bars";

export const SOURCES = [
  { id: "close", label: "Close" },
  { id: "open", label: "Open" },
  { id: "high", label: "High" },
  { id: "low", label: "Low" },
  { id: "hl2", label: "(H+L)/2" },
  { id: "hlc3", label: "(H+L+C)/3" },
  { id: "ohlc4", label: "(O+H+L+C)/4" },
] as const;

export type Source = (typeof SOURCES)[number]["id"];

export function sourceValues(bars: Bar[], source: Source): number[] {
  return bars.map((b) => {
    switch (source) {
      case "open":
        return b.open;
      case "high":
        return b.high;
      case "low":
        return b.low;
      case "hl2":
        return (b.high + b.low) / 2;
      case "hlc3":
        return (b.high + b.low + b.close) / 3;
      case "ohlc4":
        return (b.open + b.high + b.low + b.close) / 4;
      default:
        return b.close;
    }
  });
}

/** Simple moving average. Skips leading NaNs (so it can smooth another indicator). */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) sum -= values[i - period]!;
    if (count >= period) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of its first `period` values. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (Number.isNaN(prev)) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Bollinger Bands: SMA ± mult × population standard deviation over `period`. */
export function bollinger(values: number[], period: number, mult: number) {
  const middle = sma(values, period);
  const upper = new Array<number>(values.length).fill(NaN);
  const lower = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    sum += v;
    sumSq += v * v;
    if (i >= period) {
      const old = values[i - period]!;
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= period - 1) {
      const mean = sum / period;
      const sd = Math.sqrt(Math.max(0, sumSq / period - mean * mean));
      upper[i] = mean + mult * sd;
      lower[i] = mean - mult * sd;
    }
  }
  return { upper, middle, lower };
}

/** Relative Strength Index with Wilder's smoothing (0–100). */
export function rsi(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = value();
  }
  return out;
}

/** MACD: EMA(fast) − EMA(slow), its EMA(signal), and the difference (histogram). */
export function macd(values: number[], fast: number, slow: number, signal: number) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => f[i]! - s[i]!);
  const sig = ema(line, signal);
  const histogram = line.map((v, i) => v - sig[i]!);
  return { macd: line, signal: sig, histogram };
}

/** One Heikin-Ashi candle from the previous Heikin-Ashi candle (or none) and the real candle. */
export function heikinAshiNext(prev: Bar | null | undefined, b: Bar): Bar {
  const close = (b.open + b.high + b.low + b.close) / 4;
  const open = prev ? (prev.open + prev.close) / 2 : (b.open + b.close) / 2;
  return { time: b.time, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close), volume: b.volume };
}

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) out.push(heikinAshiNext(out[out.length - 1], b));
  return out;
}

// ---------------------------------------------------------------------------
// Indicator settings, as the user picks them.

export type IndicatorType = "sma" | "ema" | "bb" | "rsi" | "macd";

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  period: number;
  source: Source;
  color: string;
  /** Bollinger: standard deviations. */
  mult?: number;
  /** MACD */
  fast?: number;
  slow?: number;
  signal?: number;
}

export const INDICATOR_TYPES: Array<{ type: IndicatorType; name: string; short: string; pane: boolean; about: string }> = [
  { type: "sma", name: "Simple moving average", short: "SMA", pane: false, about: "Average price over a period" },
  { type: "ema", name: "Exponential moving average", short: "EMA", pane: false, about: "Average that weights recent prices more" },
  { type: "bb", name: "Bollinger Bands", short: "BB", pane: false, about: "Average ± standard deviations" },
  { type: "rsi", name: "Relative Strength Index", short: "RSI", pane: true, about: "Momentum, 0–100 (70 / 30 levels)" },
  { type: "macd", name: "MACD", short: "MACD", pane: true, about: "Trend momentum: fast − slow EMA" },
];

export const INDICATOR_COLORS = ["#C8A24A", "#5B9BD5", "#A07CD8", "#3FB5A8", "#E08A3C", "#D66BA0", "#85BB65"];

export const MAX_INDICATORS = 10;
export const MAX_PANES = 3;

export function newIndicator(type: IndicatorType, existing: IndicatorConfig[] = []): IndicatorConfig {
  const used = new Set(existing.map((i) => i.color));
  const color = INDICATOR_COLORS.find((c) => !used.has(c)) ?? INDICATOR_COLORS[existing.length % INDICATOR_COLORS.length]!;
  const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  switch (type) {
    case "sma":
      return { id, type, period: 20, source: "close", color };
    case "ema":
      return { id, type, period: 50, source: "close", color };
    case "bb":
      return { id, type, period: 20, mult: 2, source: "close", color };
    case "rsi":
      return { id, type, period: 14, source: "close", color };
    case "macd":
      return { id, type, period: 26, fast: 12, slow: 26, signal: 9, source: "close", color };
  }
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Repairs settings read from storage or typed in: unknown types dropped, numbers clamped, colours checked. */
export function sanitizeIndicator(raw: unknown, others: IndicatorConfig[] = []): IndicatorConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!INDICATOR_TYPES.some((t) => t.type === r.type)) return null;
  const base = newIndicator(r.type as IndicatorType, others);
  const color = typeof r.color === "string" && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : base.color;
  const source = SOURCES.some((s) => s.id === r.source) ? (r.source as Source) : "close";
  const id = typeof r.id === "string" && /^[\w-]{1,60}$/.test(r.id) ? r.id : base.id;
  const out: IndicatorConfig = { ...base, id, color, source, period: clampInt(r.period, 1, 500, base.period) };
  if (out.type === "bb") {
    const m = Number(r.mult);
    out.mult = Number.isFinite(m) ? Math.min(10, Math.max(0.1, m)) : 2;
  }
  if (out.type === "macd") {
    out.fast = clampInt(r.fast, 1, 200, 12);
    out.slow = clampInt(r.slow, 2, 400, 26);
    out.signal = clampInt(r.signal, 1, 200, 9);
    out.period = out.slow;
  }
  return out;
}

export function sanitizeIndicators(raw: unknown): IndicatorConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: IndicatorConfig[] = [];
  let panes = 0;
  for (const r of raw) {
    const c = sanitizeIndicator(r, out);
    if (!c || out.length >= MAX_INDICATORS) continue;
    const pane = INDICATOR_TYPES.find((t) => t.type === c.type)!.pane;
    if (pane && panes >= MAX_PANES) continue;
    if (pane) panes++;
    out.push(c);
  }
  return out;
}

export function isPane(c: IndicatorConfig): boolean {
  return c.type === "rsi" || c.type === "macd";
}

/** "SMA 20", "BB 20 2", "MACD 12 26 9" (the source is shown when it isn't the close). */
export function indicatorLabel(c: IndicatorConfig): string {
  const short = INDICATOR_TYPES.find((t) => t.type === c.type)!.short;
  const nums = c.type === "macd" ? `${c.fast} ${c.slow} ${c.signal}` : c.type === "bb" ? `${c.period} ${c.mult}` : `${c.period}`;
  const src = c.source === "close" ? "" : ` ${SOURCES.find((s) => s.id === c.source)?.label ?? c.source}`;
  return `${short} ${nums}${src}`;
}

/** Every line an indicator draws, by name: sma/ema/rsi → value; bb → upper, middle, lower; macd → macd, signal, histogram. */
export function computeIndicator(c: IndicatorConfig, bars: Bar[]): Record<string, number[]> {
  const v = sourceValues(bars, c.source);
  switch (c.type) {
    case "sma":
      return { value: sma(v, c.period) };
    case "ema":
      return { value: ema(v, c.period) };
    case "bb":
      return bollinger(v, c.period, c.mult ?? 2);
    case "rsi":
      return { value: rsi(v, c.period) };
    case "macd":
      return macd(v, c.fast ?? 12, c.slow ?? 26, c.signal ?? 9);
  }
}
