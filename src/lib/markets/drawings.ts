// Chart drawings (trend lines, horizontal lines, Fibonacci retracements), anchored to time and
// price so they stay put while the chart scrolls, zooms or changes timeframe. Pure helpers.

export type DrawTool = "trend" | "hline" | "fib";

export const DRAW_TOOLS: Array<{ id: DrawTool; label: string; points: 1 | 2 }> = [
  { id: "trend", label: "Trend line", points: 2 },
  { id: "hline", label: "Horizontal line", points: 1 },
  { id: "fib", label: "Fibonacci retracement", points: 2 },
];

export interface DrawPoint {
  /** Unix seconds; may fall between candles or beyond the newest one. */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawTool;
  points: DrawPoint[];
}

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const MAX_DRAWINGS_PER_SYMBOL = 50;

/** Fibonacci levels from the first point (0) to the second (1). */
export function fibLevels(a: DrawPoint, b: DrawPoint): Array<{ ratio: number; price: number }> {
  return FIB_RATIOS.map((ratio) => ({ ratio, price: b.price + (a.price - b.price) * ratio }));
}

/**
 * Position of a time on the chart's candle index scale ("logical"), fractional between candles
 * and extrapolated with the candle length before the first / after the last candle.
 */
export function timeToLogical(times: number[], t: number, tf: number): number {
  const n = times.length;
  if (!n) return 0;
  if (t <= times[0]!) return (t - times[0]!) / tf;
  if (t >= times[n - 1]!) return n - 1 + (t - times[n - 1]!) / tf;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - times[lo]!) / (times[hi]! - times[lo]!);
}

export function logicalToTime(times: number[], l: number, tf: number): number {
  const n = times.length;
  if (!n) return 0;
  if (l <= 0) return Math.round(times[0]! + l * tf);
  if (l >= n - 1) return Math.round(times[n - 1]! + (l - (n - 1)) * tf);
  const i = Math.floor(l);
  return Math.round(times[i]! + (l - i) * (times[i + 1]! - times[i]!));
}

export function newDrawing(type: DrawTool, points: DrawPoint[]): Drawing {
  return { id: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, type, points: points.map((p) => ({ ...p })) };
}

/** Repairs drawings read from storage: unknown types and broken points dropped. */
export function sanitizeDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const d = r as Record<string, unknown>;
    const tool = DRAW_TOOLS.find((t) => t.id === d.type);
    if (!tool || !Array.isArray(d.points)) continue;
    const points = (d.points as unknown[])
      .map((p) => p as Record<string, unknown>)
      .filter((p) => p && Number.isFinite(Number(p.time)) && Number.isFinite(Number(p.price)))
      .map((p) => ({ time: Math.round(Number(p.time)), price: Number(p.price) }));
    if (points.length !== tool.points) continue;
    const id = typeof d.id === "string" && /^[\w-]{1,60}$/.test(d.id) ? d.id : newDrawing(tool.id, points).id;
    out.push({ id, type: tool.id, points });
    if (out.length >= MAX_DRAWINGS_PER_SYMBOL) break;
  }
  return out;
}

/** All drawings, by market id. */
export type DrawingStore = Record<string, Drawing[]>;

export function sanitizeDrawingStore(raw: unknown): DrawingStore {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DrawingStore = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(deriv|binance):[A-Za-z0-9_]{2,30}$/.test(id)) continue;
    const d = sanitizeDrawings(list);
    if (d.length) out[id] = d;
  }
  return out;
}
