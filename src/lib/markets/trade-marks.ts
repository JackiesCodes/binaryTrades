// The user's trades drawn on the Markets chart: an arrow where each opened, its result where it
// closed, and entry / stop / target lines for open trades. Pure helpers.

import { bucketStart } from "@/lib/markets/bars";
import type { Trade } from "@/lib/trading/types";

export interface TradeMark {
  /** Candle start the mark sits on. */
  time: number;
  kind: "open" | "close";
  side: "buy" | "sell";
  text: string;
  /** Closed trades: won (true) or lost (false). */
  won?: boolean;
}

export interface TradeLine {
  id: string;
  price: number;
  kind: "entry" | "stop" | "target";
  title: string;
}

/** Trades on this Deriv market and account type (demo / real), rejected orders left out. */
export function tradesForMarket(trades: Trade[], code: string, book: Trade["book"]): Trade[] {
  return trades.filter((t) => t.data_symbol === code && t.book === book && t.status !== "rejected");
}

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

/**
 * Marks for the chart's candles: each sits on the candle its time falls in (with `tf`-second
 * candles), sorted by time as the chart requires, and only on candles the chart has.
 */
export function tradeMarks(trades: Trade[], tf: number, barTimes: Set<number>): TradeMark[] {
  const out: TradeMark[] = [];
  for (const t of trades) {
    const opened = bucketStart(Math.floor(Date.parse(t.opened_at) / 1000), tf);
    if (barTimes.has(opened)) out.push({ time: opened, kind: "open", side: t.side, text: t.side === "buy" ? "Buy" : "Sell" });
    if (t.status === "closed" && t.closed_at) {
      const closed = bucketStart(Math.floor(Date.parse(t.closed_at) / 1000), tf);
      if (barTimes.has(closed)) out.push({ time: closed, kind: "close", side: t.side, text: signed(t.pnl), won: t.pnl >= 0 });
    }
  }
  return out.sort((a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === "open" ? -1 : 1));
}

/** Entry, stop and target lines for the open trades. */
export function tradeLines(trades: Trade[]): TradeLine[] {
  const out: TradeLine[] = [];
  for (const t of trades) {
    if (t.status !== "open" && t.status !== "pending") continue;
    const side = t.side === "buy" ? "Buy" : "Sell";
    if (t.entry_price) out.push({ id: `${t.id}:entry`, price: t.entry_price, kind: "entry", title: `${side} ${signed(t.pnl)}` });
    if (t.sl) out.push({ id: `${t.id}:stop`, price: t.sl, kind: "stop", title: "Stop" });
    if (t.tp) out.push({ id: `${t.id}:target`, price: t.tp, kind: "target", title: "Target" });
  }
  return out;
}
