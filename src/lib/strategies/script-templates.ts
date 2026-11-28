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
    id: "timed_trade",
    name: "Trade every candle (timed)",
    description: "Opens a trade at every candle close and closes it one candle later — e.g. every 5 minutes on M5.",
    code: `// Opens a trade at every candle close and closes it at the next one.
// On the M5 timeframe: a new trade every 5 minutes, each held for 5 minutes.
// direction: 1 = buy, -1 = sell. Set "Reward : risk" to 0 so trades close on time, not on a target.
const direction = input("direction", 1);

function onBar(i) {
  // restart: true closes the previous trade and opens a fresh one on this candle.
  return { action: direction > 0 ? "buy" : "sell", restart: true };
}
`,
  },
  {
    id: "two_candle_momentum",
    name: "Two-candle momentum (M15, one trade, $20 / $50)",
    description:
      "One bot, both directions, one trade at a time. Two closed candles the same colour with the newer body bigger: buy (bullish) or sell (bearish). A new trade only after the open one hits its stop or target. Stop 20 away, target 50 away — with the bot's risk at Fixed $20 that's the minimum 0.01 lot on gold: lose $20 or win $50.",
    code: `// Two-Candle Momentum — one bot, both directions, one trade at a time (bot timeframe: M15).
//
// On every closed candle it compares the last two closed candles:
//   • both bullish (close > open) and the newer body is bigger → BUY
//   • both bearish (close < open) and the newer body is bigger → SELL
//   • anything else (mixed colours, a doji, or the newer body not bigger) → no trade
// Body = |close − open|; wicks are ignored. The candle still forming is never used.
//
// Only ONE trade is ever open. While it runs, every new setup (buy or sell) is ignored. As soon as
// it hits its stop loss or take profit, the bot looks for the next setup in either direction.
// It never closes a trade early: each trade ends at its stop or its target (or, with the bot's
// Protect profits on, at its trailing stop — the script follows that too, so tests match live).
//
// Stop and target are fixed distances from the entry: stop_distance, and stop_distance × reward_ratio.
// The money comes from the bot's Risk setting. Gold, risk "Fixed $" 20, stop_distance 20,
// reward_ratio 2.5 → 0.01 lot (the minimum): the stop loses $20, the target wins $50.
// (Other markets: pick the stop_distance where the minimum size loses $20, e.g. EUR/USD 0.01 lot →
// 0.02 = 200 pips.)
//
// direction: 0 = both ways (default), 1 = buys only, -1 = sells only.

const direction = input("direction", 0);         // 0 = both ways, one trade at a time · 1 = buys only · -1 = sells only
const stopInput = input("stop_distance", 20);    // price distance to the stop (gold: 20 → $20 at 0.01 lot)
const rewardInput = input("reward_ratio", 2.5);  // target = stop distance × this (2.5 → $20 risk : $50 reward)

// Bad settings must never stop the bot (a script error pauses it): fall back to safe values.
const stopDistance = isFinite(stopInput) && stopInput > 0 ? stopInput : 20;
const rewardRatio = isFinite(rewardInput) && rewardInput > 0 ? rewardInput : 2.5;
const wantBuys = direction >= 0;
const wantSells = direction <= 0;
if (stopDistance !== stopInput) console.log("stop_distance must be above 0 — using " + stopDistance);
if (rewardRatio !== rewardInput) console.log("reward_ratio must be above 0 — using " + rewardRatio);

function kind(k) {
  if (!isFinite(open[k]) || !isFinite(close[k])) return "none";
  return close[k] > open[k] ? "bull" : close[k] < open[k] ? "bear" : "doji";
}
const body = (k) => Math.abs(close[k] - open[k]);

// The script follows its own trade candle by candle (stop / target hit or not), so backtests
// match live trading. Live, the trade at the broker is the final word on the latest candle.
let trade = null; // { side: "buy" | "sell", entryIndex, entry, r, stop, target, best, trail }

function updateTrade(i) {
  if (!trade || trade.entryIndex >= i) return;
  const dir = trade.side === "buy" ? 1 : -1;
  // Checked like the backtester: the trailing stop first, then the stop, then the target.
  const hitTrail = trade.trail !== null && (dir === 1 ? low[i] <= trade.trail : high[i] >= trade.trail);
  const hitStop = dir === 1 ? low[i] <= trade.stop : high[i] >= trade.stop;
  const hitTarget = trade.target !== null && (dir === 1 ? high[i] >= trade.target : low[i] <= trade.target);
  if (hitTrail || hitStop || hitTarget) {
    trade = null;
    return;
  }
  if (protect) {
    // Protect profits: once start_r × the stop distance in profit, the stop follows distance_r behind.
    trade.best = dir === 1 ? Math.max(trade.best, high[i]) : Math.min(trade.best, low[i]);
    if ((trade.best - trade.entry) * dir >= protect.start_r * trade.r) {
      const next = trade.best - dir * protect.distance_r * trade.r;
      if (trade.trail === null || (next - trade.trail) * dir > 0) trade.trail = next;
    }
  }
}

function onBar(i) {
  updateTrade(i);
  const latestLive = live && i === bars.length - 1;
  if (latestLive) {
    // The broker knows best whether a trade is still open (fills, slippage, gaps).
    trade = brokerPosition ? { side: brokerPosition.side, entryIndex: i, entry: brokerPosition.entry, r: stopDistance, stop: NaN, target: null, best: NaN, trail: null } : null;
  }
  if (i < 1) return;

  const k1 = kind(i - 1);
  const k2 = kind(i);
  const b1 = body(i - 1);
  const b2 = body(i);
  let signal = null;
  let reason = "";
  if (k1 === "bull" && k2 === "bull" && b2 > b1) signal = "buy";
  else if (k1 === "bear" && k2 === "bear" && b2 > b1) signal = "sell";
  else if (k1 === "doji" || k2 === "doji") reason = "a doji";
  else if (k1 !== k2) reason = "mixed colours";
  else reason = "candle 2 body not bigger";

  if (signal === "buy" && !wantBuys) { reason = "buy signal, but this bot only sells"; signal = null; }
  if (signal === "sell" && !wantSells) { reason = "sell signal, but this bot only buys"; signal = null; }
  if (signal && !trade && !canOpen(i)) { reason = signal + " signal, but outside the bot's trading hours"; signal = null; }
  if (signal && trade) {
    reason = signal + " signal, but a " + trade.side + " is still open (one trade at a time: waits for its stop or target)";
    signal = null;
  }

  if (latestLive) {
    console.log(
      new Date(time[i] * 1000).toISOString() + " · candle 1 " + k1 + " body " + b1.toFixed(5) + " · candle 2 " + k2 + " body " + b2.toFixed(5) +
        " · " + (signal ? signal.toUpperCase() : "NO TRADE (" + reason + ")"),
    );
  }

  if (signal) {
    const entry = close[i]; // the next candle opens here (live: the current price)
    const dir = signal === "buy" ? 1 : -1;
    const stop = entry - dir * stopDistance;
    const target = entry + dir * stopDistance * rewardRatio;
    if (!(stop > 0) || !(target > 0)) return trade ? undefined : "close"; // distance too big for this price
    // On Deriv a trade also closes once it has lost its stake (price ÷ multiplier away).
    const cap = maxStopDistance(entry);
    trade = {
      side: signal,
      entryIndex: i,
      entry,
      r: stopDistance,
      stop: stopDistance > cap ? entry - dir * cap : stop,
      target: protect && protect.no_target ? null : target,
      best: entry,
      trail: null,
    };
    if (latestLive) console.log("  stop " + stop.toFixed(5) + " · target " + target.toFixed(5));
    // restart: a fresh trade even when the last one in this direction just ended.
    return { action: signal, stop, target, restart: true };
  }
  // Keep an open trade exactly as it is (it ends at its stop or target); otherwise stay flat.
  if (trade) return trade.side;
  return "close";
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
  { name: '{ action, restart: true }', detail: "Close the current trade and open a fresh one now, even in the same direction (timed strategies)." },
  { name: "position", detail: "{ side: \"long\" | \"short\" | null, entryIndex, entryPrice, barsHeld } — the script's own position." },
  { name: "account", detail: "{ broker, balance, equity, currency, is_demo } of the bot's account (a $10,000 demo in tests)." },
  { name: "brokerPosition, live", detail: "Live only: this bot's open trade at the broker ({ side, entry, size, pnl }) or null; live is false in tests." },
  { name: "protect", detail: "The bot's Protect profits setting ({ start_r, distance_r, no_target }) or null — for scripts that follow their own trade." },
  { name: "maxStopDistance(price) canOpen(i)", detail: "Deriv: the farthest a stop can be (price ÷ multiplier; Infinity elsewhere). canOpen(i): false outside the bot's trading hours." },
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
