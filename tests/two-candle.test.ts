import { beforeAll, describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/strategies/backtest";
import { checkScript, loadScriptEngine, runScript, scriptStrategy, type ScriptContext } from "@/lib/strategies/script";
import { SCRIPT_TEMPLATES } from "@/lib/strategies/script-templates";
import type { Candle } from "@/lib/strategies/types";
import type { QuickJSWASMModule } from "quickjs-emscripten";

const code = SCRIPT_TEMPLATES.find((t) => t.id === "two_candle_momentum")!.code;
let qjs: QuickJSWASMModule;
beforeAll(async () => {
  qjs = await loadScriptEngine();
});

/** Candles from [open, close] pairs, with small wicks (0.1) so stops are only hit where we mean them to be. */
const candles = (oc: Array<[number, number, number?, number?]>): Candle[] =>
  oc.map(([o, c, hi, lo], i) => ({ epoch: 1_800_000_000 + i * 900, open: o, close: c, high: hi ?? Math.max(o, c) + 0.1, low: lo ?? Math.min(o, c) - 0.1 }));

const P = { stop_distance: 1, reward_ratio: 2 }; // stop 1 away, target 2 away (default direction 0: both ways)

describe("Two-candle momentum script", () => {
  it("is a valid script with the expected inputs", async () => {
    const run = await checkScript(code);
    expect(run.inputs).toEqual({ direction: 0, stop_distance: 20, reward_ratio: 2.5 });
  });

  it("buys on two bullish candles with a bigger second body; skips while open; re-enters after the target", () => {
    const c = candles([
      [100, 100.5], // 0 bull, body 0.5
      [100.5, 101.5], // 1 bull, body 1.0 > 0.5 → BUY (stop 100.5, target 103.5)
      [101.5, 102.7], // 2 bull, bigger again → but a buy is open: skip
      [102.7, 102.2], // 3 bear → nothing
      [102.2, 103.8, 103.9], // 4 reaches 103.5: target hit; mixed colours → stay flat
      [103.8, 105.6], // 5 bull, body 1.8 > 1.6 → BUY again
      [105.6, 105.6], // 6 doji → holds the open buy
    ]);
    const run = runScript(qjs, code, c, P);
    expect([...run.positions]).toEqual([0, 1, 1, 1, 0, 1, 1]);
    expect([...run.levels.keys()]).toEqual([1, 5]);
    expect(run.levels.get(1)).toEqual({ stop: 100.5, target: 103.5, restart: true });
    expect(run.levels.get(5)).toEqual({ stop: 104.6, target: 107.6, restart: true });
  });

  it("no trade on a doji, mixed colours, or a second body that isn't bigger", () => {
    const run = runScript(qjs, code, candles([[100, 101], [101, 101], [101, 102], [102, 101.5], [101.5, 102.5], [102.5, 103.4]]), P);
    // 1 doji · 2 after a doji · 3 mixed · 4 mixed · 5 bull after bull but body 0.9 < 1.0
    expect([...run.positions]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(run.levels.size).toBe(0);
  });

  it("sells on two bearish candles with a bigger second body; a stop hit frees it for the next one", () => {
    const c = candles([
      [100, 99.5], // 0 bear 0.5
      [99.5, 98.5], // 1 bear 1.0 → SELL (stop 99.5, target 96.5)
      [98.5, 99.6, 99.7], // 2 reaches 99.5: stopped out; mixed → flat
      [99.6, 99.0], // 3 bear 0.6
      [99.0, 98.0], // 4 bear 1.0 → SELL again
    ]);
    const run = runScript(qjs, code, c, P);
    expect([...run.positions]).toEqual([0, -1, 0, 0, -1]);
    expect(run.levels.get(1)).toMatchObject({ stop: 99.5, target: 96.5, restart: true });
    // A buys-only bot ignores sell setups.
    expect(runScript(qjs, code, c, { ...P, direction: 1 }).levels.size).toBe(0);
  });

  it("one trade at a time: an opposite setup waits until the open trade hits its stop or target, then the next setup trades", () => {
    const c = candles([
      [100, 100.5], // 0 bull
      [100.5, 101.5], // 1 → BUY (stop 100.5, target 103.5)
      [101.5, 101.2], // 2 bear 0.3
      [101.2, 100.7], // 3 bear 0.5 → sell setup, but the buy is still open (low 100.6 > stop 100.5): wait
      [100.7, 100.6, 100.75, 100.3], // 4 dips to 100.3: the buy's stop (100.5) is hit; bear 0.1 < 0.5 → no setup
      [100.6, 100.3], // 5 bear 0.3 > 0.1 → SELL (the buy is gone)
    ]);
    const run = runScript(qjs, code, c, P);
    expect([...run.positions]).toEqual([0, 1, 1, 1, 0, -1]);
    expect([...run.levels.keys()]).toEqual([1, 5]);
  });

  it("live: the trade at the broker decides — never closes or doubles an open trade, re-enters when it's gone", () => {
    const c = candles([
      [100, 100.5],
      [100.5, 101.5], // BUY setup on the latest candle
    ]);
    const open: ScriptContext = { live: true, account: null, broker_position: { side: "buy", entry: 100.6, size: 0.1, pnl: 3 } };
    const held = runScript(qjs, code, c, P, open);
    expect(held.positions.at(-1)).toBe(1); // keep the open buy…
    expect(held.levels.size).toBe(0); // …and don't open (or restart) another
    expect(held.logs.at(-1)).toContain("NO TRADE (buy signal, but a buy is still open (one trade at a time: waits for its stop or target))");
    // A sell setup while a buy is open at the broker: also waits (one trade at a time).
    const sellSetup = candles([[100, 99.5], [99.5, 98.5]]);
    const waits = runScript(qjs, code, sellSetup, P, open);
    expect(waits.positions.at(-1)).toBe(1);
    expect(waits.levels.size).toBe(0);

    const flat: ScriptContext = { live: true, account: null, broker_position: null };
    const enters = runScript(qjs, code, c, P, flat);
    expect(enters.positions.at(-1)).toBe(1);
    expect(enters.levels.get(1)).toMatchObject({ restart: true });
    expect(enters.logs.join("\n")).toMatch(/BUY[\s\S]*stop 100\.50000 · target 103\.50000/);

    // No setup, a buy still open at the broker even though the script's own copy has ended: keep it.
    const later = candles([[100, 100.5], [100.5, 101.5], [101.5, 104, 104.1], [104, 103.5]]);
    expect(runScript(qjs, code, later, P, open).positions.at(-1)).toBe(1);
    // No setup and nothing open: flat (nothing to close).
    expect(runScript(qjs, code, later, P, flat).positions.at(-1)).toBe(0);
  });

  it("bad settings never break it (a script error would pause the bot)", () => {
    const c = candles([[100, 100.5], [100.5, 101.5]]);
    const run = runScript(qjs, code, c, { stop_distance: -5, reward_ratio: 0 });
    expect(run.levels.get(1)).toMatchObject({ stop: 81.5, target: 151.5 }); // defaults 20 and 2.5
    expect(run.logs.join(" ")).toMatch(/stop_distance must be above 0/);
    // A stop bigger than the price itself: skipped, no error.
    expect(runScript(qjs, code, c, { stop_distance: 500 }).levels.size).toBe(0);
    // A target that would be below 0 (a sell at a low price): skipped too.
    expect(runScript(qjs, code, candles([[3, 2.5], [2.5, 1.5]]), { stop_distance: 1, reward_ratio: 2 }).levels.size).toBe(0);
  });

  it("backtests on a long series without errors, inside the time budget", async () => {
    let price = 3600;
    const long: Candle[] = Array.from({ length: 5000 }, (_, i) => {
      const o = price;
      price = Math.max(1, price + Math.sin(i * 0.7) * 3 + Math.cos(i * 0.13) * 2);
      return { epoch: 1_800_000_000 + i * 900, open: o, close: price, high: Math.max(o, price) + 1, low: Math.min(o, price) - 1 };
    });
    const def = await scriptStrategy(code);
    const started = Date.now();
    const result = runBacktest(long, def, { stop_distance: 4, reward_ratio: 2.5 }, { initialBalance: 10_000, riskPercent: 0.2, costPercent: 0.02, timeframe: 900 });
    expect(result.trades.length).toBeGreaterThan(5);
    expect(new Set(result.trades.map((t) => t.side))).toEqual(new Set(["buy", "sell"])); // both ways
    // Never two at once: each trade opens after the previous one closed.
    for (let k = 1; k < result.trades.length; k++) expect(result.trades[k]!.entry_epoch).toBeGreaterThanOrEqual(result.trades[k - 1]!.exit_epoch);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
