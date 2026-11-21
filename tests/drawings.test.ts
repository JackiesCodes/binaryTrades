import { describe, expect, it } from "vitest";

import { DEFAULT_WATCHLIST, MAX_WATCHLIST, sanitizeWatchlist } from "@/components/markets/watchlist";
import { MAX_DRAWINGS_PER_SYMBOL, fibLevels, logicalToTime, newDrawing, sanitizeDrawingStore, sanitizeDrawings, timeToLogical } from "@/lib/markets/drawings";

describe("drawings", () => {
  const times = [1000, 1060, 1120, 1180]; // 1-minute candles

  it("maps times to candle positions and back, between and beyond candles", () => {
    expect(timeToLogical(times, 1060, 60)).toBe(1);
    expect(timeToLogical(times, 1090, 60)).toBe(1.5);
    expect(timeToLogical(times, 1300, 60)).toBe(5); // two candles past the newest
    expect(timeToLogical(times, 880, 60)).toBe(-2);
    for (const l of [-2, 0, 0.25, 1.5, 3, 7.5]) expect(timeToLogical(times, logicalToTime(times, l, 60), 60)).toBeCloseTo(l);
    // A line drawn on 1-minute candles lands at the same moment on 5-minute candles.
    const fiveMin = [0, 300, 600, 900, 1200];
    expect(timeToLogical(fiveMin, 1090, 300)).toBeCloseTo(1090 / 300);
    expect(timeToLogical([], 5, 60)).toBe(0);
  });

  it("puts Fibonacci levels from the first point (0) to the second (1)", () => {
    const levels = fibLevels({ time: 0, price: 200 }, { time: 1, price: 100 });
    expect(levels.map((l) => l.ratio)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    expect(levels[0]!.price).toBe(100);
    expect(levels.at(-1)!.price).toBe(200);
    expect(levels.find((l) => l.ratio === 0.618)!.price).toBeCloseTo(161.8);
  });

  it("repairs saved drawings and keeps them per market", () => {
    const good = newDrawing("trend", [
      { time: 1, price: 2 },
      { time: 3, price: 4 },
    ]);
    const list = sanitizeDrawings([good, { type: "hline", points: [{ time: 5, price: 9 }] }, { type: "trend", points: [{ time: 1, price: 1 }] }, { type: "laser" }, null]);
    expect(list.map((d) => d.type)).toEqual(["trend", "hline"]);
    expect(list[0]).toEqual(good);
    expect(sanitizeDrawings(Array.from({ length: 80 }, () => good))).toHaveLength(MAX_DRAWINGS_PER_SYMBOL);
    const store = sanitizeDrawingStore({ "binance:BTCUSDT": [good], "evil:<x>": [good], "deriv:R_100": [] });
    expect(Object.keys(store)).toEqual(["binance:BTCUSDT"]);
    expect(sanitizeDrawingStore([1, 2])).toEqual({});
  });
});

describe("watchlist", () => {
  it("starts with a default list and keeps only valid, unique markets", () => {
    expect(sanitizeWatchlist(undefined)).toEqual(DEFAULT_WATCHLIST);
    expect(sanitizeWatchlist(["binance:BTCUSDT", "binance:BTCUSDT", "nope", 5, "deriv:R_100"])).toEqual(["binance:BTCUSDT", "deriv:R_100"]);
    expect(sanitizeWatchlist([])).toEqual([]);
    expect(sanitizeWatchlist(Array.from({ length: 40 }, (_, i) => `binance:X${i}USDT`))).toHaveLength(MAX_WATCHLIST);
  });
});
