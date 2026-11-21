// What the Markets page saves for each user: watchlist, indicators, drawings and price alerts.
// Shared by the browser and the API, so the server repairs whatever it is sent.

import { sanitizeAlerts, type PriceAlert } from "@/lib/markets/alerts";
import { sanitizeDrawingStore, type DrawingStore } from "@/lib/markets/drawings";
import { sanitizeIndicators, type IndicatorConfig } from "@/lib/markets/indicators";
import { parseSymbolId } from "@/lib/markets/symbols";

export const MAX_WATCHLIST = 30;
export const DEFAULT_WATCHLIST = ["binance:BTCUSDT", "binance:ETHUSDT", "deriv:frxXAUUSD", "deriv:frxEURUSD", "deriv:R_100"];
/** Largest saved document, in characters of JSON. */
export const MAX_STATE_SIZE = 400_000;

export function sanitizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WATCHLIST];
  const ids = raw.filter((x): x is string => typeof x === "string" && parseSymbolId(x) !== null);
  return [...new Set(ids)].slice(0, MAX_WATCHLIST);
}

export interface MarketsDoc {
  watchlist: string[];
  indicators: IndicatorConfig[];
  drawings: DrawingStore;
  alerts: PriceAlert[];
}

export const MARKETS_KEYS = ["watchlist", "indicators", "drawings", "alerts"] as const;
export type MarketsKey = (typeof MARKETS_KEYS)[number];

export function sanitizePart<K extends MarketsKey>(key: K, raw: unknown): MarketsDoc[K] {
  switch (key) {
    case "watchlist":
      return sanitizeWatchlist(raw) as MarketsDoc[K];
    case "indicators":
      return sanitizeIndicators(raw) as MarketsDoc[K];
    case "drawings":
      return sanitizeDrawingStore(raw) as MarketsDoc[K];
    default:
      return sanitizeAlerts(raw) as MarketsDoc[K];
  }
}
