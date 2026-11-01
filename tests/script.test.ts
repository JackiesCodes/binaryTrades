import { describe, expect, it } from "vitest";

import { runBacktest } from "@/lib/strategies/backtest";
import { ScriptError, checkScript, loadScriptEngine, looksLikePine, runScript, sampleCandles, scriptStrategy } from "@/lib/strategies/script";
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
    await expect(checkScript(`const x = 1;`)).rejects.toThrow(/must define a function called onBar/);
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
});
