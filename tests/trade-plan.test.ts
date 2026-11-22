import { describe, expect, it } from "vitest";

import type { Bar } from "@/lib/markets/bars";
import { levelsProblem, suggestLevels } from "@/lib/markets/trade-plan";

// Candles 2.0 tall each (high - low), no gaps: ATR(14) = 2.
const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ time: i * 60, open: 100, high: 101, low: 99, close: 100 }));

describe("trade from the chart", () => {
  it("suggests a 2 × ATR stop and a target twice as far, on the right sides", () => {
    expect(suggestLevels(bars, "buy", 100)).toEqual({ stop: 96, target: 108 });
    expect(suggestLevels(bars, "sell", 100)).toEqual({ stop: 104, target: 92 });
    expect(suggestLevels(bars.slice(0, 10), "buy", 100)).toBeNull(); // not enough candles
  });

  it("checks the levels are on the correct side of the price", () => {
    expect(levelsProblem("buy", 100, 96, 108)).toBeNull();
    expect(levelsProblem("buy", 100, 101, 108)).toMatch(/stop goes below/);
    expect(levelsProblem("buy", 100, 96, 99)).toMatch(/target goes above/);
    expect(levelsProblem("sell", 100, 99, 92)).toMatch(/stop goes above/);
    expect(levelsProblem("sell", 100, 104, 101)).toMatch(/target goes below/);
    expect(levelsProblem("buy", 100, null, null)).toBeNull(); // both optional
    expect(levelsProblem("buy", null, 5, 6)).toBeNull(); // no price yet: can't judge sides
    expect(levelsProblem("sell", 100, -1, null)).toMatch(/above 0/);
  });
});
