// A bot's trades drawn on the Markets chart ("Bot on chart"): what its strategy did over the latest
// candles and what it holds now. Pure helpers, safe for the browser.

import { bucketStart, type TimeframeId } from "@/lib/markets/bars";

export interface BotPreviewTrade {
  side: "buy" | "sell";
  entry_epoch: number;
  exit_epoch: number;
  entry: number;
  exit: number;
  pnl: number;
  r_multiple: number;
  /** "end" = still open at the latest candle. */
  reason: "signal" | "stop" | "target" | "end";
  stop: number;
  target: number | null;
}

export interface BotPreview {
  bot: { id: string; name: string; timeframe: number; data_symbol: string };
  range: { from: number; to: number; bars: number };
  metrics: { net_profit: number; trades: number; win_rate: number; profit_factor: number | null; max_drawdown_percent: number };
  trades: BotPreviewTrade[];
  open: BotPreviewTrade | null;
  currency: string;
  /** Something about how this bot will really trade that the user should know (e.g. Deriv's stake limit). */
  warning?: string | null;
}

export interface BotMark {
  time: number;
  kind: "open" | "close";
  side: "buy" | "sell";
  text: string;
  won?: boolean;
}

const money = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

/** Entry arrows and exit results on the chart's candles (only candles it has), sorted by time. */
export function botMarks(trades: BotPreviewTrade[], tf: number, barTimes: Set<number>): BotMark[] {
  const out: BotMark[] = [];
  for (const t of trades) {
    const opened = bucketStart(t.entry_epoch, tf);
    if (barTimes.has(opened)) out.push({ time: opened, kind: "open", side: t.side, text: t.side === "buy" ? "Bot buy" : "Bot sell" });
    if (t.reason === "end") continue; // still open: no result yet
    const closed = bucketStart(t.exit_epoch, tf);
    if (barTimes.has(closed)) out.push({ time: closed, kind: "close", side: t.side, text: money(t.pnl), won: t.pnl >= 0 });
  }
  return out.sort((a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === "open" ? -1 : 1));
}

const BY_SECONDS: Record<number, TimeframeId> = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1D" };

/** The Markets timeframe for a bot's candle length, or null when the chart has no such timeframe. */
export function timeframeForBot(seconds: number): TimeframeId | null {
  return BY_SECONDS[seconds] ?? null;
}

/** "in a BUY since 10:15 · stop 3,712.40 · target 3,762.40" / "waiting for a setup". */
export function botNowText(preview: BotPreview, fmt: (n: number) => string): string {
  const o = preview.open;
  if (!o) return "waiting for a setup";
  const since = new Date(o.entry_epoch * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `in a ${o.side.toUpperCase()} since ${since} · stop ${fmt(o.stop)}${o.target !== null ? ` · target ${fmt(o.target)}` : ""}`;
}
