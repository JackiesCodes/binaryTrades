import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/strategies/backtest";
import { ScriptError, checkScript, loadScriptEngine, looksLikePine, runScript, runScriptAlert, sampleCandles, scriptStrategy } from "@/lib/strategies/script";
import { SCRIPT_TEMPLATES } from "@/lib/strategies/script-templates";

const candles = sampleCandles(400);

describe("script bots", () => {
  it("turns onBar results into held positions", async () => {
    const qjs = await loadScriptEngine();
    const code = `function onBar(i) { if (i === 5) return "buy"; if (i === 10) return "close"; if (i === 12) return "sell"; }`;
    const { positions } = runScript(qjs, code, candles.slice(0, 15), {});
    expect(Array.from(positions)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, -1, -1, -1]);
  });

  it("reports declared inputs and applies per-bot values", async () => {
    const code = `const n = input("length", 20); console.log("length is", n); function onBar(i) {}`;
    expect(await checkScript(code)).toMatchObject({ inputs: { length: 20 }, logs: ["length is 20"] });
    expect((await checkScript(code, { length: 7 })).logs).toEqual(["length is 7"]);
  });

  it("lets scripts reuse built-in names inside their own scope", async () => {
    await expect(checkScript(`const close = 1; function onBar(i) {}`)).resolves.toBeTruthy();
  });

  it("runs every template and backtests it", async () => {
    for (const t of SCRIPT_TEMPLATES) {
      const def = await scriptStrategy(t.code);
      const result = runBacktest(candles, def, { atr_mult: 2, rr: 2 }, { initialBalance: 10_000, riskPercent: 1, costPercent: 0.02, timeframe: 3600 });
      expect(Number.isFinite(result.metrics.return_percent)).toBe(true);
    }
  });

  it("reports errors with the editor line number", async () => {
    await expect(checkScript(`// first\nfunction onBar(i) {\n  return nope + 1;\n}`)).rejects.toThrow(/^Line 3: ReferenceError/);
    await expect(checkScript(`function onBar(i) { return "moon"; }`)).rejects.toThrow(/returned "moon"/);
    await expect(checkScript(`const x = 1;`)).rejects.toThrow(/must define onBar\(i\), onAlert/);
  });

  it("stops endless loops", async () => {
    await expect(checkScript(`while (true) {}\nfunction onBar(i) {}`)).rejects.toThrow(/longer than 3s/);
  });

  it("has no access to the server", async () => {
    const code = `console.log(typeof process, typeof require, typeof fetch, typeof globalThis.__BARS_JSON); function onBar(i) {}`;
    expect((await checkScript(code)).logs).toEqual(["undefined undefined undefined string"]);
  });

  it("recognises TradingView Pine Script", async () => {
    const pine = `//@version=5\nstrategy("My strat", overlay=true)\nif ta.crossover(ta.sma(close, 9), ta.sma(close, 21))\n    strategy.entry("L", strategy.long)`;
    expect(looksLikePine(pine)).toBe(true);
    expect(looksLikePine(SCRIPT_TEMPLATES[0]!.code)).toBe(false);
    await expect(checkScript(pine)).rejects.toBeInstanceOf(ScriptError);
  });

  it("records the stop and target a script sets, and tracks its position", async () => {
    const qjs = await loadScriptEngine();
    const code = `function onBar(i) {
      if (i === 3) return { action: "buy", stop: 900, target: 1200 };
      if (position.side === "long" && position.barsHeld >= 2) return "close";
    }`;
    const run = runScript(qjs, code, candles.slice(0, 10), {});
    expect(Array.from(run.positions)).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
    expect(run.levels.get(3)).toMatchObject({ stop: 900, target: 1200, restart: false });
    await expect(checkScript(`function onBar(i) { return { action: "buy", stop: -1 }; }`)).rejects.toThrow(/stop must be a price/);
  });

  it("lets onAlert decide on TradingView alerts, with alert-only scripts allowed", async () => {
    const code = `const t = ema(close, 5);
      function onAlert(alert, i) {
        console.log("got", alert.action, alert.rsi);
        if (alert.action === "buy" && alert.rsi < 30) return { action: "buy", stop: low[i] - 1 };
      }`;
    const run = await checkScript(code);
    expect(run).toMatchObject({ hasOnAlert: true, hasOnBar: false });
    const ctx = { live: true, account: null, broker_position: null };
    const yes = await runScriptAlert(code, candles, {}, ctx, { action: "buy", rsi: 25 });
    expect(yes.action).toBe(1);
    expect(yes.stop).toBeCloseTo(candles.at(-1)!.low - 1);
    expect(yes.logs).toEqual(["got buy 25"]);
    const no = await runScriptAlert(code, candles, {}, ctx, { action: "buy", rsi: 70 });
    expect(no.action).toBeNull();
    await expect(runScriptAlert(`function onBar(i) {}`, candles, {}, ctx, {})).rejects.toThrow(/no onAlert/);
  });

  it("restarts a trade every bar for timed strategies, in backtests too", async () => {
    const code = `function onBar(i) { return { action: "buy", restart: true }; }`;
    const qjs = await loadScriptEngine();
    const run = runScript(qjs, code, candles.slice(0, 6), {});
    expect(Array.from(run.positions)).toEqual([1, 1, 1, 1, 1, 1]);
    expect([...run.levels.values()].every((l) => l.restart)).toBe(true);
    const def = await scriptStrategy(code);
    const result = runBacktest(candles.slice(0, 66), def, { atr_mult: 50, rr: 0 }, { initialBalance: 10_000, riskPercent: 1, costPercent: 0, timeframe: 300 });
    // One trade per bar once ATR(14) exists (bars 16–65), each closed at the next bar's open.
    expect(result.trades.length).toBeGreaterThanOrEqual(48);
    expect(result.trades.filter((t) => t.reason !== "end").every((t) => t.exit_epoch - t.entry_epoch === 3600)).toBe(true);
  });
});
