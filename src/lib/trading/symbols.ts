// Deriv market-data symbols used for candles, signals and backtests.
export const DATA_SYMBOLS = [
  { value: "frxEURUSD", label: "EUR/USD", group: "Forex" },
  { value: "frxGBPUSD", label: "GBP/USD", group: "Forex" },
  { value: "frxUSDJPY", label: "USD/JPY", group: "Forex" },
  { value: "frxAUDUSD", label: "AUD/USD", group: "Forex" },
  { value: "frxUSDCAD", label: "USD/CAD", group: "Forex" },
  { value: "frxXAUUSD", label: "Gold (XAU/USD)", group: "Commodities" },
  { value: "cryBTCUSD", label: "BTC/USD", group: "Crypto" },
  { value: "cryETHUSD", label: "ETH/USD", group: "Crypto" },
  { value: "R_75", label: "Volatility 75 Index", group: "Deriv synthetics" },
  { value: "R_100", label: "Volatility 100 Index", group: "Deriv synthetics" },
  { value: "R_50", label: "Volatility 50 Index", group: "Deriv synthetics" },
  { value: "1HZ100V", label: "Volatility 100 (1s) Index", group: "Deriv synthetics" },
  { value: "stpRNG", label: "Step Index", group: "Deriv synthetics" },
  { value: "BOOM1000", label: "Boom 1000 Index", group: "Boom & Crash" },
  { value: "BOOM500", label: "Boom 500 Index", group: "Boom & Crash" },
  { value: "BOOM300N", label: "Boom 300 Index", group: "Boom & Crash" },
  { value: "CRASH1000", label: "Crash 1000 Index", group: "Boom & Crash" },
  { value: "CRASH500", label: "Crash 500 Index", group: "Boom & Crash" },
  { value: "CRASH300N", label: "Crash 300 Index", group: "Boom & Crash" },
] as const;

export const TIMEFRAMES = [
  { value: 60, label: "M1" },
  { value: 300, label: "M5" },
  { value: 900, label: "M15" },
  { value: 1800, label: "M30" },
  { value: 3600, label: "H1" },
  { value: 14400, label: "H4" },
  { value: 86400, label: "D1" },
] as const;

export function timeframeLabel(seconds: number): string {
  return TIMEFRAMES.find((t) => t.value === seconds)?.label ?? `${seconds}s`;
}

const CRYPTO = ["BTC", "ETH", "LTC", "XRP", "BCH"];

/**
 * Best-effort mapping from a broker symbol to its Deriv data symbol, e.g.
 * Exness "EURUSDm" → "frxEURUSD", "XAUUSDm" → "frxXAUUSD", "BTCUSDm" → "cryBTCUSD".
 */
export function guessDataSymbol(brokerSymbol: string): string {
  const s = brokerSymbol.trim();
  if (/^(frx|cry|R_|1HZ|BOOM|CRASH|JD|stpRNG)/.test(s)) return s;
  const core = s.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  if (core.length < 6) return s;
  return CRYPTO.includes(core.slice(0, 3)) ? `cry${core}` : `frx${core}`;
}

export function symbolLabel(dataSymbol: string): string {
  return DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol;
}

/**
 * Multipliers Deriv accepts for each market (from Deriv's contracts_for, checked Nov 2026).
 * Markets not listed here aren't checked; Deriv itself still validates the order.
 */
export const DERIV_MULTIPLIERS: Record<string, readonly number[]> = {
  stpRNG: [750, 2000, 3500, 5500, 7500],
  frxXAUUSD: [100, 200, 300, 500, 800],
  frxXAGUSD: [100, 200, 300, 500, 800],
  frxEURUSD: [100, 200, 300, 500, 800],
  frxGBPUSD: [100, 200, 300, 500, 800],
  frxUSDJPY: [100, 200, 300, 500, 800],
  frxAUDUSD: [100, 200, 300, 500, 800],
  cryBTCUSD: [100, 200, 300, 500, 800],
  cryETHUSD: [100, 200, 300, 500, 800],
  R_75: [50, 100, 200, 300, 500],
  "1HZ75V": [50, 100, 200, 300, 500],
  R_100: [40, 100, 200, 300, 400],
  "1HZ100V": [40, 100, 200, 300, 400],
  R_50: [80, 200, 400, 600, 800],
  "1HZ50V": [80, 200, 400, 600, 800],
  R_25: [160, 400, 800, 1200, 1600],
  "1HZ25V": [160, 400, 800, 1200, 1600],
  R_10: [400, 1000, 2000, 3000, 4000],
  "1HZ10V": [400, 1000, 2000, 3000, 4000],
  BOOM1000: [100, 200, 300, 400, 500],
  CRASH1000: [100, 200, 300, 400, 500],
  BOOM500: [100, 150, 200, 300, 400],
  CRASH500: [100, 150, 200, 300, 400],
  JD10: [100, 200, 300, 500, 1000],
};

/** The multipliers Deriv accepts on this market, or null when we don't know them. */
export function allowedMultipliers(symbol: string): readonly number[] | null {
  return DERIV_MULTIPLIERS[symbol] ?? null;
}

/**
 * A multiplier Deriv accepts on this market: the one asked for when it's allowed (or the market
 * is unknown), otherwise the allowed value closest to it (e.g. ×100 on Step Index → ×750).
 */
export function validMultiplier(symbol: string, wanted: number): number {
  const allowed = allowedMultipliers(symbol);
  if (!allowed || allowed.includes(wanted)) return wanted;
  return allowed.reduce((best, m) => (Math.abs(m - wanted) < Math.abs(best - wanted) ? m : best), allowed[0]!);
}

/** Starting multiplier for a new bot: ×100 where Deriv allows it, else the market's lowest. */
export function defaultMultiplier(symbol: string): number {
  const allowed = allowedMultipliers(symbol);
  return !allowed || allowed.includes(100) ? 100 : allowed[0]!;
}

export function multiplierMessage(symbol: string, multiplier: number, allowed: readonly number[]): string {
  return `Deriv doesn't allow ×${multiplier} on ${symbolLabel(symbol)}. Choose one of: ${allowed.map((m) => `×${m}`).join(", ")}.`;
}
