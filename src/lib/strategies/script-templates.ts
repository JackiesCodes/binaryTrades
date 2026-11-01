// Starting points for script bots, shown in the Scripts editor. Safe for the browser.

export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  code: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: "ema_cross",
    name: "EMA crossover",
    description: "Buy when the fast EMA crosses above the slow EMA, sell when it crosses below.",
    code: `// EMA crossover — always in the market, flips on each cross.
const fast = ema(close, input("fast", 20));
const slow = ema(close, input("slow", 50));

function onBar(i) {
  if (crossover(fast, slow, i)) return "buy";
  if (crossunder(fast, slow, i)) return "sell";
  // returning nothing keeps the current position
}
`,
  },
  {
    id: "rsi_reversal",
    name: "RSI reversal with trend filter",
    description: "Buy oversold dips above the 200 EMA, sell overbought rallies below it, exit when RSI is back at 50.",
    code: `// RSI reversal in the direction of the long-term trend.
const r = rsi(close, input("rsi_length", 14));
const trend = ema(close, 200);
const oversold = input("oversold", 30);

function onBar(i) {
  if (r[i] < oversold && close[i] > trend[i]) return "buy";
  if (r[i] > 100 - oversold && close[i] < trend[i]) return "sell";
  if (crossover(r, 50, i) || crossunder(r, 50, i)) return "close";
}
`,
  },
  {
    id: "breakout",
    name: "Channel breakout",
    description: "Buy a close above the highest high of the last N bars, sell a close below the lowest low.",
    code: `// Donchian-style breakout. Compare with the PREVIOUS bar's channel.
const n = input("length", 20);
const hi = highest(high, n);
const lo = lowest(low, n);

function onBar(i) {
  if (i < 1) return;
  if (close[i] > hi[i - 1]) return "buy";
  if (close[i] < lo[i - 1]) return "sell";
}
`,
  },
  {
    id: "macd",
    name: "MACD signal cross",
    description: "Buy when MACD crosses above its signal line while above zero, sell on the mirror image.",
    code: `const m = macd(close, input("fast", 12), input("slow", 26), input("signal", 9));

function onBar(i) {
  if (crossover(m.macd, m.signal, i) && m.macd[i] > 0) return "buy";
  if (crossunder(m.macd, m.signal, i) && m.macd[i] < 0) return "sell";
  if (crossunder(m.macd, m.signal, i) || crossover(m.macd, m.signal, i)) return "close";
}
`,
  },
  {
    id: "tradingview_filter",
    name: "TradingView alert filter",
    description: "Trades your TradingView alerts only when they agree with the trend here, with a stop below the recent swing.",
    code: `// Runs for every TradingView alert sent to this bot (no onBar: it never trades on its own).
// In TradingView, use the alert message shown under "TradingView setup" on the bot card.
// Every field you add to that JSON arrives in alert, e.g. alert.action, alert.price, alert.rsi.
const trend = ema(close, input("trend", 200));
const swing = input("swing_bars", 10);

function onAlert(alert, i) {
  if (alert.action === "buy" && close[i] > trend[i]) {
    return { action: "buy", stop: lowest(low, swing)[i] };
  }
  if (alert.action === "sell" && close[i] < trend[i]) {
    return { action: "sell", stop: highest(high, swing)[i] };
  }
  if (alert.action === "close") return "close";
  console.log("ignored", alert.action, "against the trend");
  // returning nothing ignores the alert
}
`,
  },
  {
    id: "managed_exit",
    name: "Breakout with own stop & time exit",
    description: "Sets its own stop and target on each entry, and closes a trade that hasn't worked within N bars.",
    code: `// Shows the script's own risk control: stop & target prices, and position.barsHeld.
const n = input("length", 20);
const hi = highest(high, n);
const lo = lowest(low, n);
const a = atr(14);
const maxBars = input("max_bars", 24);

function onBar(i) {
  if (i < n + 1) return;
  if (position.side && position.barsHeld >= maxBars) return "close";
  if (close[i] > hi[i - 1]) return { action: "buy", stop: close[i] - 1.5 * a[i], target: close[i] + 3 * a[i] };
  if (close[i] < lo[i - 1]) return { action: "sell", stop: close[i] + 1.5 * a[i], target: close[i] - 3 * a[i] };
}
`,
  },
  {
    id: "blank",
    name: "Blank script",
    description: "Start from scratch.",
    code: `// Runs once per closed candle. i is the index of that candle.
// Return "buy", "sell" or "close" — or nothing to keep the current position.

function onBar(i) {
}
`,
  },
];

export const SCRIPT_REFERENCE: Array<{ name: string; detail: string }> = [
  { name: "onBar(i)", detail: 'Required. Called for every closed candle; return "buy", "sell", "close", or nothing to hold.' },
  { name: "open high low close time", detail: "Price series (arrays). close[i] is the close of bar i. Never read beyond index i." },
  { name: "hl2 hlc3 bars", detail: "(high+low)/2, (high+low+close)/3, and bars[i] = { time, open, high, low, close }." },
  { name: 'input("name", 20)', detail: "A setting you can change per bot without editing the code." },
  { name: "sma ema rma rsi (src, n)", detail: "Moving averages and RSI. e.g. ema(close, 50)" },
  { name: "atr(n)", detail: "Average True Range. Stops are set from ATR(14) × the bot's stop setting." },
  { name: "highest lowest stdev change (src, n)", detail: "Rolling high / low / standard deviation / difference." },
  { name: "bollinger(src, n, mult)", detail: "{ upper, middle, lower }" },
  { name: "macd(src, 12, 26, 9)", detail: "{ macd, signal, histogram }" },
  { name: "crossover crossunder (a, b, i)", detail: "a crossed above / below b on bar i. b can be a series or a number." },
  { name: '{ action: "buy", stop, target }', detail: "Return this instead of \"buy\" to set your own stop-loss and take-profit prices for the trade." },
  { name: "onAlert(alert, i)", detail: "Optional. Runs for each TradingView alert sent to the bot; alert holds every field of the alert JSON. Return like onBar." },
  { name: "position", detail: "{ side: \"long\" | \"short\" | null, entryIndex, entryPrice, barsHeld } — the script's own position." },
  { name: "account", detail: "{ broker, balance, equity, currency, is_demo } of the bot's account (a $10,000 demo in tests)." },
  { name: "brokerPosition, live", detail: "Live only: this bot's open trade at the broker ({ side, entry, size, pnl }) or null; live is false in tests." },
  { name: "console.log(...)", detail: "Shows up under Output when you test the script." },
];

/** TradingView Pine Script can't run here; spot it so we can say so clearly. */
export function looksLikePine(code: string): boolean {
  return (
    /^\s*\/\/\s*@version\s*=\s*\d/m.test(code) ||
    /^\s*(strategy|indicator|study)\s*\(/m.test(code) ||
    /\bta\.(sma|ema|rsi|crossover|crossunder|atr)\s*\(/.test(code) ||
    /\bstrategy\.(entry|close|exit)\s*\(/.test(code)
  );
}
