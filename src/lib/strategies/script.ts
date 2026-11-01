import "server-only";

import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSWASMModule } from "quickjs-emscripten";

import { looksLikePine } from "@/lib/strategies/script-templates";
import type { Candle, StrategyDefinition } from "@/lib/strategies/types";

export { looksLikePine };

/**
 * Script bots: strategies written (or pasted) as JavaScript by the owner.
 *
 * Scripts never run in the server's own JavaScript engine. Each run gets a fresh
 * QuickJS interpreter compiled to WebAssembly, with no access to the network,
 * files, environment variables or the app's code, a 3-second time budget and a
 * 64 MB memory cap. The only things a script sees are the candles, its inputs and
 * the indicator helpers defined in PRELUDE below; the only thing it returns is a
 * position (long / short / flat) for each bar.
 */

export const SCRIPT_STRATEGY_ID = "script";
export const MAX_SCRIPT_LENGTH = 50_000;

const TIME_BUDGET_MS = 3000;
const MEMORY_LIMIT = 64 * 1024 * 1024;
const MAX_LOG_LINES = 50;

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line ? `Line ${line}: ${message}` : message);
  }
}

let quickjs: Promise<QuickJSWASMModule> | null = null;

/** Loads the WebAssembly interpreter once per server process. */
export function loadScriptEngine(): Promise<QuickJSWASMModule> {
  quickjs ??= getQuickJS().catch((error) => {
    quickjs = null;
    throw error;
  });
  return quickjs;
}

// Runs inside the sandbox before the user's script. Plain JavaScript (ES2020).
// Indicator results are cached per input series, so calling ema(close, 20) inside
// onBar() on every bar costs the same as calling it once.
const PRELUDE = String.raw`
"use strict";
const __bars = JSON.parse(globalThis.__BARS_JSON);
const __params = JSON.parse(globalThis.__PARAMS_JSON);
const __inputs = {};
const __logs = [];
const bars = __bars.map((b) => ({ time: b.epoch, open: b.open, high: b.high, low: b.low, close: b.close }));
const time = bars.map((b) => b.time);
const open = bars.map((b) => b.open);
const high = bars.map((b) => b.high);
const low = bars.map((b) => b.low);
const close = bars.map((b) => b.close);
const hl2 = bars.map((b) => (b.high + b.low) / 2);
const hlc3 = bars.map((b) => (b.high + b.low + b.close) / 3);
const console = {
  log: (...args) => {
    if (__logs.length < ${MAX_LOG_LINES}) __logs.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));
  },
};

function input(name, defaultValue) {
  if (typeof name !== "string" || !name) throw new Error("input(name, defaultValue): name must be a text like \"fast\"");
  if (typeof defaultValue !== "number" || !isFinite(defaultValue)) throw new Error("input(\"" + name + "\", …): the default must be a number");
  __inputs[name] = defaultValue;
  const v = Number(__params[name]);
  return Object.prototype.hasOwnProperty.call(__params, name) && isFinite(v) ? v : defaultValue;
}

const __cache = new Map();
function __memo(kind, src, args, compute) {
  if (!Array.isArray(src)) throw new Error(kind + "(): the first argument must be a series such as close");
  let bySrc = __cache.get(src);
  if (!bySrc) { bySrc = new Map(); __cache.set(src, bySrc); }
  const key = kind + ":" + args.join(",");
  if (!bySrc.has(key)) bySrc.set(key, compute());
  return bySrc.get(key);
}
function __len(n, kind) {
  if (!Number.isInteger(n) || n < 1) throw new Error(kind + "(): length must be a whole number ≥ 1");
  return n;
}

function sma(src, n) {
  __len(n, "sma");
  return __memo("sma", src, [n], () => {
    const out = new Array(src.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
      sum += src[i];
      if (i >= n) sum -= src[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  });
}
function ema(src, n) {
  __len(n, "ema");
  return __memo("ema", src, [n], () => {
    const out = new Array(src.length).fill(NaN);
    const k = 2 / (n + 1);
    let prev = NaN;
    for (let i = 0; i < src.length; i++) {
      if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += src[j]; prev = s / n; }
      else if (i >= n) prev = src[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  });
}
function rma(src, n) {
  __len(n, "rma");
  return __memo("rma", src, [n], () => {
    const out = new Array(src.length).fill(NaN);
    let prev = NaN;
    for (let i = 0; i < src.length; i++) {
      if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += src[j]; prev = s / n; }
      else if (i >= n) prev = (prev * (n - 1) + src[i]) / n;
      out[i] = prev;
    }
    return out;
  });
}
function rsi(src, n) {
  __len(n, "rsi");
  return __memo("rsi", src, [n], () => {
    const out = new Array(src.length).fill(NaN);
    let gain = 0, loss = 0;
    for (let i = 1; i < src.length; i++) {
      const d = src[i] - src[i - 1];
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; } else continue; }
      else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  });
}
function atr(n) {
  __len(n, "atr");
  return __memo("atr", close, [n], () => {
    const tr = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
    return rma(tr, n);
  });
}
function highest(src, n) {
  __len(n, "highest");
  return __memo("highest", src, [n], () => src.map((_, i) => (i < n - 1 ? NaN : Math.max(...src.slice(i - n + 1, i + 1)))));
}
function lowest(src, n) {
  __len(n, "lowest");
  return __memo("lowest", src, [n], () => src.map((_, i) => (i < n - 1 ? NaN : Math.min(...src.slice(i - n + 1, i + 1)))));
}
function stdev(src, n) {
  __len(n, "stdev");
  return __memo("stdev", src, [n], () => {
    const mean = sma(src, n);
    return src.map((_, i) => {
      if (i < n - 1) return NaN;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (src[j] - mean[i]) ** 2;
      return Math.sqrt(s / n);
    });
  });
}
function bollinger(src, n, mult) {
  const m = mult === undefined ? 2 : mult;
  return __memo("bollinger", src, [n, m], () => {
    const mid = sma(src, n), sd = stdev(src, n);
    return { middle: mid, upper: mid.map((v, i) => v + m * sd[i]), lower: mid.map((v, i) => v - m * sd[i]) };
  });
}
function macd(src, fast, slow, signal) {
  const f = fast || 12, s = slow || 26, g = signal || 9;
  return __memo("macd", src, [f, s, g], () => {
    const fa = ema(src, f), sl = ema(src, s);
    const line = src.map((_, i) => fa[i] - sl[i]);
    const firstValid = line.findIndex((v) => !isNaN(v));
    const sig = new Array(src.length).fill(NaN);
    if (firstValid >= 0) {
      const tail = ema(line.slice(firstValid), g);
      for (let i = 0; i < tail.length; i++) sig[firstValid + i] = tail[i];
    }
    return { macd: line, signal: sig, histogram: line.map((v, i) => v - sig[i]) };
  });
}
function __at(x, i) { return Array.isArray(x) ? x[i] : x; }
function crossover(a, b, i) { return i > 0 && __at(a, i - 1) <= __at(b, i - 1) && __at(a, i) > __at(b, i); }
function crossunder(a, b, i) { return i > 0 && __at(a, i - 1) >= __at(b, i - 1) && __at(a, i) < __at(b, i); }
function change(src, n) { const k = n || 1; return __memo("change", src, [k], () => src.map((v, i) => (i < k ? NaN : v - src[i - k]))); }
`;

// Turns every onBar() result into a position string: "1" long, "2" short, "0" flat.
const RUNNER = String.raw`
(() => {
  const onBar = globalThis.__onBar;
  if (typeof onBar !== "function") throw new Error("Your script must define a function called onBar(i) — see the examples.");
  let pos = 0;
  let out = "";
  for (let i = 0; i < bars.length; i++) {
    const r = onBar(i);
    if (r === undefined || r === null || r === "hold") {}
    else if (r === 1 || r === "buy" || r === "long") pos = 1;
    else if (r === -1 || r === "sell" || r === "short") pos = -1;
    else if (r === 0 || r === "close" || r === "flat" || r === "exit") pos = 0;
    else throw new Error("onBar(" + i + ") returned " + JSON.stringify(r) + ' — return "buy", "sell", "close" or nothing to hold');
    out += pos === -1 ? "2" : String(pos);
  }
  return JSON.stringify({ p: out, inputs: __inputs, logs: __logs });
})()
`;

export interface ScriptRun {
  positions: Int8Array;
  /** Inputs the script declared with input(name, default), with their defaults. */
  inputs: Record<string, number>;
  logs: string[];
}

function evalOrThrow(ctx: QuickJSContext, code: string, filename: string): unknown {
  const result = ctx.evalCode(code, filename);
  if (result.error) {
    const err = ctx.dump(result.error) as { name?: string; message?: string; stack?: string } | string;
    result.error.dispose();
    if (typeof err === "string") throw new ScriptError(err);
    if (err?.message === "interrupted") throw new ScriptError(`Script took longer than ${TIME_BUDGET_MS / 1000}s — look for an endless loop.`);
    const line = Number(err?.stack?.match(/script\.js:(\d+)/)?.[1]) || undefined;
    const name = err?.name && err.name !== "Error" ? `${err.name}: ` : "";
    throw new ScriptError(`${name}${err?.message ?? "Script error"}`, line);
  }
  const value = ctx.dump(result.value);
  result.value.dispose();
  return value;
}

/** Runs a script over the candles inside a fresh sandbox. Synchronous once the engine is loaded. */
export function runScript(qjs: QuickJSWASMModule, code: string, candles: Candle[], params: Record<string, number>): ScriptRun {
  if (code.length > MAX_SCRIPT_LENGTH) throw new ScriptError(`Script is too long (max ${MAX_SCRIPT_LENGTH} characters).`);
  const runtime = qjs.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIME_BUDGET_MS));
  const ctx = runtime.newContext();
  try {
    const setString = (name: string, value: string) => {
      const handle = ctx.newString(value);
      ctx.setProp(ctx.global, name, handle);
      handle.dispose();
    };
    setString("__BARS_JSON", JSON.stringify(candles));
    setString("__PARAMS_JSON", JSON.stringify(params ?? {}));
    evalOrThrow(ctx, PRELUDE, "prelude.js");
    // The script runs inside its own function so it may reuse any name (even "close"),
    // and on the same first line so error line numbers match the editor.
    evalOrThrow(
      ctx,
      `globalThis.__onBar = (function () {${code}\n;return typeof onBar === "function" ? onBar : undefined;\n})();`,
      "script.js",
    );
    const raw = evalOrThrow(ctx, RUNNER, "runner.js");
    const out = JSON.parse(String(raw)) as { p: string; inputs: Record<string, number>; logs: string[] };
    const positions = new Int8Array(out.p.length);
    for (let i = 0; i < out.p.length; i++) positions[i] = out.p[i] === "1" ? 1 : out.p[i] === "2" ? -1 : 0;
    return { positions, inputs: out.inputs, logs: out.logs };
  } finally {
    ctx.dispose();
    runtime.dispose();
  }
}

/** A deterministic random-walk series used to check a script before any market data is fetched. */
export function sampleCandles(count = 300): Candle[] {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let price = 1000;
  const start = 1_700_000_000;
  return Array.from({ length: count }, (_, i) => {
    const open = price;
    const close = Math.max(1, open * (1 + (rand() - 0.5) * 0.02));
    price = close;
    return {
      epoch: start + i * 3600,
      open,
      close,
      high: Math.max(open, close) * (1 + rand() * 0.005),
      low: Math.min(open, close) * (1 - rand() * 0.005),
    };
  });
}

/** Validates a script (syntax, onBar, return values) and reports the inputs it declares. */
export async function checkScript(code: string, params: Record<string, number> = {}): Promise<ScriptRun> {
  if (looksLikePine(code)) {
    throw new ScriptError(
      "This looks like TradingView Pine Script. Pine runs only on TradingView — use a TradingView alerts bot for it, or write the strategy in JavaScript here.",
    );
  }
  return runScript(await loadScriptEngine(), code, sampleCandles(), params);
}

export const SCRIPT_RISK_PARAMS = [
  { key: "atr_mult", label: "Stop (× ATR)", default: 2, grid: [2] },
  { key: "rr", label: "Reward : risk (0 = exit on signal)", default: 2, grid: [2] },
];

/** Wraps a script as a StrategyDefinition so the backtester and the engine treat it like any built-in strategy. */
export async function scriptStrategy(code: string, name = "Script"): Promise<StrategyDefinition> {
  const qjs = await loadScriptEngine();
  return {
    id: SCRIPT_STRATEGY_ID,
    name,
    style: "Custom script",
    description: "Your own JavaScript strategy.",
    params: SCRIPT_RISK_PARAMS,
    positions: (candles, params) => runScript(qjs, code, candles, params).positions,
  };
}
