import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/strategies/backtest";
import type { Candle } from "@/lib/strategies/types";
import { sanitizeTrail, trailLabel, trailStep, type TrailConfig } from "@/lib/trading/trail";

const BE: TrailConfig = { start_r: 1, distance_r: 1 };
const at = (p: number) => ({ high: p, low: p });

describe("trailing stop rule", () => {
  const buy = { side: "buy" as const, entry: 100, firstStop: 80 }; // 1 R = 20

  it("waits until the trade is start × R in profit, then moves to break-even and follows", () => {
    let s = { best: 100, stop: null as number | null };
    s = trailStep(buy, BE, s, at(115)); // +15: not yet
    expect(s).toMatchObject({ best: 115, stop: null, hit: false });
    s = trailStep(buy, BE, s, at(120)); // +20 = 1 R: stop to entry
    expect(s).toMatchObject({ best: 120, stop: 100, hit: false });
    s = trailStep(buy, BE, s, at(135)); // follows 20 behind
    expect(s).toMatchObject({ best: 135, stop: 115 });
    s = trailStep(buy, BE, s, at(125)); // pulls back: the stop doesn't move back
    expect(s).toMatchObject({ best: 135, stop: 115, hit: false });
    s = trailStep(buy, BE, s, at(114)); // back through it
    expect(s.hit).toBe(true);
  });

  it("mirrors for sells; a later start or tighter trail work too", () => {
    const sell = { side: "sell" as const, entry: 100, firstStop: 120 };
    let s = trailStep(sell, BE, { best: 100, stop: null }, at(78)); // +22
    expect(s).toMatchObject({ best: 78, stop: 98 });
    s = trailStep(sell, BE, s, { high: 99, low: 90 });
    expect(s.hit).toBe(true);
    const late = trailStep(buy, { start_r: 2, distance_r: 0.5 }, { best: 100, stop: null }, at(139));
    expect(late.stop).toBeNull();
    expect(trailStep(buy, { start_r: 2, distance_r: 0.5 }, late, at(140)).stop).toBe(130);
  });

  it("settings: repaired or refused, and described in plain words", () => {
    expect(sanitizeTrail({ start_r: "1", distance_r: 1.234, no_target: true })).toEqual({ start_r: 1, distance_r: 1.23, no_target: true });
    expect(sanitizeTrail({ start_r: 0, distance_r: 1 })).toBeNull();
    expect(sanitizeTrail({ start_r: 1, distance_r: 50 })).toBeNull();
    expect(sanitizeTrail("on")).toBeNull();
    expect(trailLabel({ start_r: 1, distance_r: 1 })).toBe("Break-even at +1R, then trails 1R behind");
    expect(trailLabel({ start_r: 1.5, distance_r: 1, no_target: true })).toBe("From +1.5R, trails 1R behind · no take profit");
  });
});

describe("backtest with protect profits", () => {
  // 30 quiet candles, a buy signal, a run up to +3 R, then a fall back to below the entry.
  const bars: Candle[] = Array.from({ length: 45 }, (_, i) => ({ epoch: i * 900, open: 100, high: 100.5, low: 99.5, close: 100 }));
  const path = [100, 101, 102, 103, 102.5, 101, 99, 97, 95];
  path.forEach((p, k) => (bars[31 + k] = { epoch: (31 + k) * 900, open: bars[30 + k]!.close, close: p, high: Math.max(p, bars[30 + k]!.close) + 0.05, low: Math.min(p, bars[30 + k]!.close) - 0.05 }));
  const want = bars.map((_, i) => (i >= 30 ? 1 : 0));
  // Signal at bar 30 → enters at bar 31's open (100) with its own stop 1 below (99) and no target.
  const scripted = {
    id: "scripted",
    name: "Scripted",
    style: "",
    description: "",
    params: [],
    positions: () => Int8Array.from(want),
    levels: () => new Map([[30, { stop: 99, target: null, restart: false }]]),
  };
  const opts = { initialBalance: 10_000, riskPercent: 1, riskAmount: 20, costPercent: 0, timeframe: 900 };

  it("without it, the winner falls back to a full loss; with it, it keeps most of the run", () => {
    const fixed = runBacktest(bars, scripted, {}, opts);
    expect(fixed.trades[0]).toMatchObject({ reason: "stop" });
    expect(fixed.trades[0]!.pnl).toBeCloseTo(-20, 1);

    const protectedRun = runBacktest(bars, scripted, {}, { ...opts, trail: { start_r: 1, distance_r: 1, no_target: true } });
    const t = protectedRun.trades[0]!;
    expect(t.reason).toBe("trail");
    expect(t.exit).toBeGreaterThan(101.9); // best ~103.05, stop ~1 R behind
    expect(t.pnl).toBeGreaterThan(38); // about +2 R at $20 per R
  });
});
