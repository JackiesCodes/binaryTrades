// Pure helpers for the Markets chart: candles, timeframes, live merging and formatting.
// Kept free of browser APIs so they can be unit-tested.

export interface Bar {
  /** Start of the candle, Unix seconds (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded volume; undefined when the market doesn't publish it (Deriv). */
  volume?: number;
}

export const TIMEFRAMES = [
  { id: "1m", label: "1m", seconds: 60, name: "1 minute" },
  { id: "5m", label: "5m", seconds: 300, name: "5 minutes" },
  { id: "15m", label: "15m", seconds: 900, name: "15 minutes" },
  { id: "1h", label: "1h", seconds: 3600, name: "1 hour" },
  { id: "4h", label: "4h", seconds: 14400, name: "4 hours" },
  { id: "1D", label: "1D", seconds: 86400, name: "1 day" },
  { id: "1W", label: "1W", seconds: 604800, name: "1 week" },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export function timeframe(id: string) {
  return TIMEFRAMES.find((t) => t.id === id);
}

export function isTimeframe(id: string): id is TimeframeId {
  return TIMEFRAMES.some((t) => t.id === id);
}

/** Weeks start on Monday 00:00 UTC (1970-01-01 was a Thursday, so Monday is 4 days later). */
const WEEK = 604800;
const MONDAY = 4 * 86400;

/** Start of the candle that `time` falls in. */
export function bucketStart(time: number, seconds: number): number {
  if (seconds === WEEK) return Math.floor((time - MONDAY) / WEEK) * WEEK + MONDAY;
  return Math.floor(time / seconds) * seconds;
}

/**
 * Groups candles into candles of `seconds` (e.g. days into weeks). Also tidies a feed's
 * own candles: snaps each to its bucket start and merges duplicates, so times always rise.
 */
export function aggregate(bars: Bar[], seconds: number): Bar[] {
  const out: Bar[] = [];
  for (const b of [...bars].sort((x, y) => x.time - y.time)) {
    const t = bucketStart(b.time, seconds);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, b.high);
      last.low = Math.min(last.low, b.low);
      last.close = b.close;
      if (b.volume !== undefined) last.volume = (last.volume ?? 0) + b.volume;
    } else {
      out.push({ ...b, time: t });
    }
  }
  return out;
}

/**
 * Puts a live candle into a series: replaces the candle with the same time, appends a newer
 * one, and ignores one older than the last (late messages after a reconnect).
 * Returns the bar that changed, or null when it was ignored. Mutates `bars`.
 */
export function mergeLive(bars: Bar[], bar: Bar): Bar | null {
  const last = bars[bars.length - 1];
  if (!last || bar.time > last.time) {
    bars.push({ ...bar });
    return bars[bars.length - 1]!;
  }
  if (bar.time === last.time) {
    bars[bars.length - 1] = { ...bar };
    return bars[bars.length - 1]!;
  }
  // Older than the newest candle: update it in place if we have it (a correction), else ignore.
  const i = bars.findIndex((b) => b.time === bar.time);
  if (i >= 0) {
    bars[i] = { ...bar };
    return null; // not the latest candle: the chart redraws it with the next full refresh
  }
  return null;
}

/**
 * For timeframes a feed can't stream directly (weeks from Deriv's days): add the live base
 * candle to `base`, then rebuild the aggregated candle it belongs to.
 */
export function foldLive(base: Bar[], live: Bar, seconds: number): Bar {
  mergeLive(base, live);
  const t = bucketStart(live.time, seconds);
  const inBucket = base.filter((b) => bucketStart(b.time, seconds) === t);
  return aggregate(inBucket, seconds)[0] ?? { ...live, time: t };
}

/** Change from `reference` to `price`, in percent; null when either is missing. */
export function changePercent(price: number | null | undefined, reference: number | null | undefined): number | null {
  if (price == null || reference == null || !Number.isFinite(price) || !Number.isFinite(reference) || reference === 0) return null;
  return ((price - reference) / reference) * 100;
}

/** The price 24 hours before the newest candle, from hourly (or finer) candles. */
export function reference24h(bars: Bar[], now = bars[bars.length - 1]?.time ?? 0): number | null {
  const since = now - 86400;
  const first = bars.find((b) => b.time >= since);
  return first ? first.open : null;
}

/** Reconnect delay: 1s, 2s, 4s … up to 30s, with ±20% jitter so many tabs don't reconnect together. */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Decimal places to show for a price: from the market's pip size when known, else from its size. */
export function priceDecimals(price: number, pipSize?: number | null): number {
  if (pipSize && pipSize > 0) return Math.max(0, Math.min(8, Math.round(-Math.log10(pipSize))));
  const p = Math.abs(price);
  if (p >= 1000) return 2;
  if (p >= 10) return 3;
  if (p >= 1) return 4;
  if (p >= 0.01) return 6;
  return 8;
}

export function formatPrice(price: number | null | undefined, decimals: number): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 1234567 → "1.23M" */
export function formatVolume(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(a >= 100 ? 0 : 2);
}
