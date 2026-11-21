import { describe, expect, it } from "vitest";

import type { Bar } from "@/lib/markets/bars";
import { MAX_PANES, bollinger, computeIndicator, ema, heikinAshi, heikinAshiNext, indicatorLabel, macd, newIndicator, rsi, sanitizeIndicators, sma, sourceValues } from "@/lib/markets/indicators";

const bars = (closes: number[]): Bar[] => closes.map((c, i) => ({ time: i * 60, open: c - 1, high: c + 2, low: c - 2, close: c }));

describe("indicators", () => {
  it("SMA and EMA line up with the candles and start once they have enough data", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]);
    // EMA reacts faster than SMA to a jump.
    const jump = [1, 1, 1, 1, 10];
    expect(ema(jump, 3)[4]!).toBeGreaterThan(sma(jump, 3)[4]!);
    // Both skip leading gaps, so they can smooth another indicator (MACD's signal line).
    expect(sma([NaN, NaN, 2, 4], 2)).toEqual([NaN, NaN, NaN, 3]);
  });

  it("Bollinger Bands are SMA ± k standard deviations", () => {
    const b = bollinger([1, 2, 3, 4], 3, 1);
    expect(b.middle[2]).toBeCloseTo(2);
    expect(b.upper[2]).toBeCloseTo(2 + Math.sqrt(2 / 3));
    expect(b.lower[3]).toBeCloseTo(3 - Math.sqrt(2 / 3));
    expect(Number.isNaN(b.upper[1]!)).toBe(true);
    const flat = bollinger([5, 5, 5, 5], 2, 2);
    expect(flat.upper[3]).toBeCloseTo(5);
  });

  it("RSI matches the StockCharts worked example (Wilder, 14)", () => {
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    const r = rsi(closes, 14);
    expect(Number.isNaN(r[13]!)).toBe(true);
    expect(r[14]).toBeCloseTo(70.46, 1);
    expect(r[15]).toBeCloseTo(66.25, 1);
    expect(r[19]).toBeCloseTo(57.92, 0);
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([5, 5, 5, 5], 2)[3]).toBe(50);
  });

  it("MACD is fast EMA − slow EMA with a signal line and histogram", () => {
    const v = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.2);
    const m = macd(v, 12, 26, 9);
    const e12 = ema(v, 12);
    const e26 = ema(v, 26);
    expect(Number.isNaN(m.macd[24]!)).toBe(true);
    expect(m.macd[40]).toBeCloseTo(e12[40]! - e26[40]!);
    expect(Number.isNaN(m.signal[32]!)).toBe(true);
    expect(Number.isFinite(m.signal[33]!)).toBe(true);
    expect(m.histogram[50]).toBeCloseTo(m.macd[50]! - m.signal[50]!);
    expect(macd(new Array(40).fill(7), 12, 26, 9).macd[39]).toBeCloseTo(0);
  });

  it("builds Heikin-Ashi candles, one at a time or all at once", () => {
    const b = bars([10, 12, 11]);
    const ha = heikinAshi(b);
    expect(ha[0]).toMatchObject({ open: (9 + 10) / 2, close: (9 + 12 + 8 + 10) / 4 });
    expect(ha[1]!.open).toBeCloseTo((ha[0]!.open + ha[0]!.close) / 2);
    expect(ha[1]!.high).toBe(Math.max(b[1]!.high, ha[1]!.open, ha[1]!.close));
    expect(heikinAshiNext(ha[1], b[2]!)).toEqual(ha[2]);
  });

  it("reads price sources", () => {
    const b = bars([10]);
    expect(sourceValues(b, "hl2")).toEqual([10]);
    expect(sourceValues(b, "ohlc4")).toEqual([(9 + 12 + 8 + 10) / 4]);
    expect(sourceValues(b, "high")).toEqual([12]);
  });

  it("computes each indicator's lines and names them", () => {
    const b = bars(Array.from({ length: 50 }, (_, i) => 100 + i));
    expect(Object.keys(computeIndicator(newIndicator("bb"), b))).toEqual(["upper", "middle", "lower"]);
    expect(Object.keys(computeIndicator(newIndicator("macd"), b))).toEqual(["macd", "signal", "histogram"]);
    expect(computeIndicator(newIndicator("sma"), b).value).toHaveLength(50);
    expect(indicatorLabel({ ...newIndicator("sma"), period: 9 })).toBe("SMA 9");
    expect(indicatorLabel({ ...newIndicator("ema"), source: "hl2" })).toBe("EMA 50 (H+L)/2");
    expect(indicatorLabel(newIndicator("macd"))).toBe("MACD 12 26 9");
  });

  it("repairs saved settings: unknown types dropped, numbers clamped, at most 3 panes", () => {
    const saved = [
      { type: "sma", period: 99999, color: "red", source: "nope" },
      { type: "evil", period: 3 },
      { type: "bb", period: 0, mult: 99 },
      { type: "rsi" },
      { type: "rsi" },
      { type: "macd", fast: "8" },
      { type: "rsi" },
    ];
    const out = sanitizeIndicators(saved);
    expect(out.map((i) => i.type)).toEqual(["sma", "bb", "rsi", "rsi", "macd"]);
    expect(out[0]).toMatchObject({ period: 500, source: "close" });
    expect(out[0]!.color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(out[1]).toMatchObject({ period: 1, mult: 10 });
    expect(out[4]).toMatchObject({ fast: 8, slow: 26, signal: 9 });
    expect(out.filter((i) => i.type === "rsi" || i.type === "macd")).toHaveLength(MAX_PANES);
    expect(sanitizeIndicators("garbage")).toEqual([]);
  });
});

describe("restored indicators", () => {
  it("get different colours when none was saved", () => {
    const out = sanitizeIndicators([{ type: "ema" }, { type: "bb" }, { type: "rsi" }]);
    expect(new Set(out.map((i) => i.color)).size).toBe(3);
  });
});
