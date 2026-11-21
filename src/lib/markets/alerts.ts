// Price alerts: "tell me when <market> goes above / below <price>". Pure helpers.

import { parseSymbolId } from "@/lib/markets/symbols";

export interface PriceAlert {
  id: string;
  /** Market id, e.g. "binance:BTCUSDT". */
  symbol: string;
  op: "above" | "below";
  price: number;
  created_at: string;
  /** When it fired; null while it's still waiting. Alerts fire once. */
  triggered_at: string | null;
  /** The price that set it off. */
  triggered_price?: number | null;
}

export const MAX_ACTIVE_ALERTS = 50;
/** Fired alerts kept as history. */
export const MAX_ALERT_HISTORY = 30;

export function newAlert(symbol: string, op: PriceAlert["op"], price: number, now = new Date()): PriceAlert {
  return {
    id: `a-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    symbol,
    op,
    price,
    created_at: now.toISOString(),
    triggered_at: null,
  };
}

/** Whether a price sets the alert off: at or beyond its level, in its direction. */
export function alertHit(a: PriceAlert, price: number): boolean {
  if (a.triggered_at || !Number.isFinite(price)) return false;
  return a.op === "above" ? price >= a.price : price <= a.price;
}

/**
 * Why an alert can't be set at this level right now (it would fire straight away), or null.
 * The suggested direction for a level: above the current price → "above", below → "below".
 */
export function alertProblem(op: PriceAlert["op"], level: number, current: number | null): string | null {
  if (!Number.isFinite(level) || level <= 0) return "Enter a price above 0.";
  if (current === null) return null;
  if (op === "above" && current >= level) return "The price is already at or above that level.";
  if (op === "below" && current <= level) return "The price is already at or below that level.";
  return null;
}

export function suggestedOp(level: number, current: number | null): PriceAlert["op"] {
  return current !== null && level < current ? "below" : "above";
}

export function activeAlerts(list: PriceAlert[]): PriceAlert[] {
  return list.filter((a) => !a.triggered_at);
}

const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Repairs alerts read from storage or sent to the API; keeps at most 50 waiting and 30 fired. */
export function sanitizeAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  const active: PriceAlert[] = [];
  const fired: PriceAlert[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    const price = Number(a.price);
    if (typeof a.symbol !== "string" || !parseSymbolId(a.symbol) || (a.op !== "above" && a.op !== "below") || !(price > 0) || !Number.isFinite(price)) continue;
    const id = typeof a.id === "string" && /^[\w-]{1,60}$/.test(a.id) && !seen.has(a.id) ? a.id : newAlert(a.symbol, a.op, price).id;
    seen.add(id);
    const triggered_at = iso(a.triggered_at);
    const tp = Number(a.triggered_price);
    const alert: PriceAlert = {
      id,
      symbol: a.symbol,
      op: a.op,
      price,
      created_at: iso(a.created_at) ?? new Date().toISOString(),
      triggered_at,
      triggered_price: triggered_at && Number.isFinite(tp) ? tp : null,
    };
    if (triggered_at) fired.push(alert);
    else active.push(alert);
  }
  fired.sort((x, y) => (y.triggered_at ?? "").localeCompare(x.triggered_at ?? ""));
  return [...active.slice(0, MAX_ACTIVE_ALERTS), ...fired.slice(0, MAX_ALERT_HISTORY)];
}
