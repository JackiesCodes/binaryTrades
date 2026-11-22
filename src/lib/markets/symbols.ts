// The Markets catalog: Deriv markets (the ones binaryTrades bots trade) and Binance crypto pairs.

export type Provider = "deriv" | "binance";

export interface MarketSymbol {
  /** "deriv:frxXAUUSD" or "binance:BTCUSDT" */
  id: string;
  provider: Provider;
  /** The provider's own code. */
  code: string;
  /** Display name, e.g. "Gold/USD" or "BTC/USDT". */
  name: string;
  /** e.g. "Forex", "Synthetics", "Crypto". */
  group: string;
  /** Deriv's pip size (decimal places), when known. */
  pipSize?: number;
  /** Whether the feed publishes volume. */
  hasVolume: boolean;
}

export function symbolId(provider: Provider, code: string): string {
  return `${provider}:${code}`;
}

export function parseSymbolId(id: string): { provider: Provider; code: string } | null {
  const m = /^(deriv|binance):([A-Za-z0-9_]{2,30})$/.exec(id);
  return m ? { provider: m[1] as Provider, code: m[2]! } : null;
}

/** Markets that appear first and work before the full lists load. */
export const STARTER_SYMBOLS: MarketSymbol[] = [
  { id: "binance:BTCUSDT", provider: "binance", code: "BTCUSDT", name: "BTC/USDT", group: "Crypto", hasVolume: true },
  { id: "binance:ETHUSDT", provider: "binance", code: "ETHUSDT", name: "ETH/USDT", group: "Crypto", hasVolume: true },
  { id: "binance:SOLUSDT", provider: "binance", code: "SOLUSDT", name: "SOL/USDT", group: "Crypto", hasVolume: true },
  { id: "deriv:frxXAUUSD", provider: "deriv", code: "frxXAUUSD", name: "Gold/USD", group: "Commodities", pipSize: 0.01, hasVolume: false },
  { id: "deriv:frxEURUSD", provider: "deriv", code: "frxEURUSD", name: "EUR/USD", group: "Forex", pipSize: 0.00001, hasVolume: false },
  { id: "deriv:frxGBPUSD", provider: "deriv", code: "frxGBPUSD", name: "GBP/USD", group: "Forex", pipSize: 0.00001, hasVolume: false },
  { id: "deriv:frxUSDJPY", provider: "deriv", code: "frxUSDJPY", name: "USD/JPY", group: "Forex", pipSize: 0.001, hasVolume: false },
  { id: "deriv:R_100", provider: "deriv", code: "R_100", name: "Volatility 100 Index", group: "Synthetics", pipSize: 0.01, hasVolume: false },
  { id: "deriv:R_75", provider: "deriv", code: "R_75", name: "Volatility 75 Index", group: "Synthetics", pipSize: 0.0001, hasVolume: false },
  { id: "deriv:stpRNG", provider: "deriv", code: "stpRNG", name: "Step Index", group: "Synthetics", pipSize: 0.1, hasVolume: false },
  { id: "deriv:BOOM1000", provider: "deriv", code: "BOOM1000", name: "Boom 1000 Index", group: "Synthetics", pipSize: 0.001, hasVolume: false },
  { id: "deriv:CRASH1000", provider: "deriv", code: "CRASH1000", name: "Crash 1000 Index", group: "Synthetics", pipSize: 0.001, hasVolume: false },
];

export const DEFAULT_SYMBOL = "binance:BTCUSDT";

const DERIV_GROUPS: Record<string, string> = {
  forex: "Forex",
  synthetic_index: "Synthetics",
  commodities: "Commodities",
  cryptocurrency: "Crypto (Deriv)",
  indices: "Stock indices",
};

/** One entry of Deriv's active_symbols ("brief") reply. */
export interface DerivActiveSymbol {
  underlying_symbol: string;
  underlying_symbol_name: string;
  market: string;
  pip_size?: number;
  is_trading_suspended?: number;
}

export function fromDeriv(list: DerivActiveSymbol[]): MarketSymbol[] {
  // Live data: skip entries without a usable code, and never let a missing name or market break search.
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.underlying_symbol === "string" && /^[A-Za-z0-9_]{2,30}$/.test(s.underlying_symbol) && !s.is_trading_suspended)
    .map((s) => ({
      id: symbolId("deriv", s.underlying_symbol),
      provider: "deriv" as const,
      code: s.underlying_symbol,
      name: typeof s.underlying_symbol_name === "string" && s.underlying_symbol_name ? s.underlying_symbol_name : s.underlying_symbol,
      group: DERIV_GROUPS[s.market] ?? (typeof s.market === "string" ? s.market : "Deriv"),
      pipSize: typeof s.pip_size === "number" && s.pip_size > 0 ? s.pip_size : undefined,
      hasVolume: false,
    }));
}

const QUOTES = ["USDT", "USDC", "FDUSD", "BTC", "ETH"];

/** Binance spot pairs from /api/v3/ticker/price; only pairs against common quote assets. */
export function fromBinance(list: Array<{ symbol: string }>): MarketSymbol[] {
  const out: MarketSymbol[] = [];
  for (const { symbol } of list) {
    const quote = QUOTES.find((q) => symbol.endsWith(q) && symbol.length > q.length);
    if (!quote) continue;
    out.push({
      id: symbolId("binance", symbol),
      provider: "binance",
      code: symbol,
      name: `${symbol.slice(0, -quote.length)}/${quote}`,
      group: "Crypto",
      hasVolume: true,
    });
  }
  return out;
}

/** Joins lists, keeping the first entry of each id (starter entries keep their order). */
export function mergeCatalog(...lists: MarketSymbol[][]): MarketSymbol[] {
  const seen = new Map<string, MarketSymbol>();
  for (const list of lists) for (const s of list) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
}

const norm = (s: string | undefined | null) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Best matches for a search: exact code or name first, then prefixes, then words that start
 * with the query, then anything containing it. Starter markets win ties.
 */
export function searchSymbols(catalog: MarketSymbol[], query: string, limit = 12): MarketSymbol[] {
  const q = norm(query);
  if (!q) return catalog.slice(0, limit);
  const starters = new Set(STARTER_SYMBOLS.map((s) => s.id));
  const scored: Array<{ s: MarketSymbol; score: number; i: number }> = [];
  catalog.forEach((s, i) => {
    const rawCode = String(s.code ?? "");
    const rawName = String(s.name ?? rawCode);
    const code = norm(rawCode.replace(/^(frx|cry)/, ""));
    const fullCode = norm(rawCode);
    const name = norm(rawName);
    const words = rawName
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    let score = 0;
    if (code === q || fullCode === q || name === q) score = 100;
    else if (code.startsWith(q) || name.startsWith(q) || fullCode.startsWith(q)) score = 80;
    else if (words.some((w) => w.startsWith(q))) score = 60;
    else if (name.includes(q) || fullCode.includes(q)) score = 40;
    if (!score) return;
    if (starters.has(s.id)) score += 5;
    // Prefer shorter names for equal matches ("BTC/USDT" before "BTCDOM/USDT").
    scored.push({ s, score: score - rawName.length / 100, i });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/** A readable name for a market id without the full catalog (server side): "BTC/USDT", "Gold/USD"… */
export function marketName(id: string): string {
  const known = STARTER_SYMBOLS.find((s) => s.id === id);
  if (known) return known.name;
  const p = parseSymbolId(id);
  if (!p) return id;
  if (p.provider === "binance") return fromBinance([{ symbol: p.code }])[0]?.name ?? p.code;
  return p.code.replace(/^frx/, "");
}
