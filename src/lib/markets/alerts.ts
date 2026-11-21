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
  /** Also email the user when it fires (checked on the server every minute). Defaults to true. */
  email?: boolean;
  /** Also trade when it fires, through one of the user's bots (demo accounts only for now). */
  trade?: AlertTrade | null;
  /** What happened to that trade, e.g. "Bought with Gold bot" or "Not placed: Bot is paused". */
  trade_result?: string | null;
}

export interface AlertTrade {
  bot_id: string;
  action: "buy" | "sell" | "close";
}

export const ALERT_TRADE_ACTIONS: Array<{ id: AlertTrade["action"]; label: string; option: string }> = [
  { id: "buy", label: "Buy", option: "Buy with a demo bot" },
  { id: "sell", label: "Sell", option: "Sell with a demo bot" },
  { id: "close", label: "Close trades", option: "Close a demo bot's trades" },
];

function sanitizeTrade(raw: unknown): AlertTrade | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.bot_id !== "string" || !/^[\w-]{1,80}$/.test(t.bot_id)) return null;
  if (t.action !== "buy" && t.action !== "sell" && t.action !== "close") return null;
  return { bot_id: t.bot_id, action: t.action };
}

/** Whether two alerts ask for the same trade (used to re-check only new or changed trade settings). */
export function sameTrade(a: AlertTrade | null | undefined, b: AlertTrade | null | undefined): boolean {
  return (a?.bot_id ?? null) === (b?.bot_id ?? null) && (a?.action ?? null) === (b?.action ?? null);
}

export const MAX_ACTIVE_ALERTS = 50;
/** Fired alerts kept as history. */
export const MAX_ALERT_HISTORY = 30;

export function newAlert(symbol: string, op: PriceAlert["op"], price: number, now = new Date(), email = true): PriceAlert {
  return {
    id: `a-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    symbol,
    op,
    price,
    created_at: now.toISOString(),
    triggered_at: null,
    email,
  };
}

/** Whether a price sets the alert off: at or beyond its level, in its direction. */
export function alertHit(a: PriceAlert, price: number): boolean {
  if (a.triggered_at || !Number.isFinite(price)) return false;
  return a.op === "above" ? price >= a.price : price <= a.price;
}

/** A 1-minute candle, as the server reads them to check alerts. */
export interface MinuteCandle {
  /** Start, Unix seconds. */
  time: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Server check, once a minute: did the market reach the alert's level? Looks at the highs / lows of
 * 1-minute candles that started after the minute the alert was set (so a spike between two checks
 * still counts), and at the latest price. Returns the price that reached it, or null.
 */
export function alertHitInCandles(a: PriceAlert, candles: MinuteCandle[]): number | null {
  if (a.triggered_at) return null;
  const created = Date.parse(a.created_at) / 1000;
  const after = Math.floor(created / 60) * 60 + 60;
  for (const c of candles) {
    if (c.time < after) continue;
    if (a.op === "above" ? c.high >= a.price : c.low <= a.price) return a.op === "above" ? c.high : c.low;
  }
  const last = candles[candles.length - 1];
  return last && alertHit(a, last.close) ? last.close : null;
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
      email: a.email !== false,
      trade: sanitizeTrade(a.trade),
      trade_result: typeof a.trade_result === "string" ? a.trade_result.slice(0, 200) : null,
    };
    if (triggered_at) fired.push(alert);
    else active.push(alert);
  }
  fired.sort((x, y) => (y.triggered_at ?? "").localeCompare(x.triggered_at ?? ""));
  return [...active.slice(0, MAX_ACTIVE_ALERTS), ...fired.slice(0, MAX_ALERT_HISTORY)];
}

/**
 * Saving alerts from a page: an alert the server has already fired stays fired, even if the page
 * (which hadn't heard yet) sends it back as waiting. Otherwise the page's list wins.
 */
export function keepServerFired(incoming: PriceAlert[], stored: PriceAlert[]): PriceAlert[] {
  const fired = new Map(stored.filter((a) => a.triggered_at).map((a) => [a.id, a]));
  return incoming.map((a) => (!a.triggered_at && fired.has(a.id) ? fired.get(a.id)! : a));
}
