import "server-only";

import { z } from "zod";

import { adjustBaseline, bookOf, marketDataId } from "@/lib/trading/engine";
import { forUser, getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { Bot, BrokerAccount, MarketData, Mt5Command, Trade } from "@/lib/trading/types";

/**
 * Server side of the MetaTrader 5 bridge (public/downloads/BinaryTradesBridge.mq5).
 *
 * MT5 has no inbound API, so the bridge EA running in your terminal calls
 * POST /api/mt5/sync every few seconds with its account state, positions,
 * recently closed deals and the results of earlier commands. The response
 * carries the next queued commands as plain text lines (easy to parse in
 * MQL5):
 *
 *   id|type|symbol|side|risk_money|sl|tp|magic|ticket|comment
 *
 * A "candles" command asks the EA (v2+) for closed bars, sent back in the next report:
 *
 *   id|candles|symbol|timeframe_seconds|count|||||
 */

const num = z.coerce.number();

export const mt5ReportSchema = z.object({
  login: z.coerce.string(),
  server: z.string().default(""),
  company: z.string().default(""),
  currency: z.string().default("USD"),
  balance: num,
  equity: num,
  is_demo: z.coerce.boolean().default(false),
  positions: z
    .array(
      z.object({
        ticket: z.coerce.string(),
        symbol: z.string(),
        type: z.enum(["buy", "sell"]),
        volume: num,
        price_open: num,
        price_current: num,
        sl: num.default(0),
        tp: num.default(0),
        profit: num,
        magic: num.default(0),
        comment: z.string().default(""),
      }),
    )
    .default([]),
  deals: z
    .array(
      z.object({
        position_id: z.coerce.string(),
        profit: num,
        price: num,
      }),
    )
    .default([]),
  results: z
    .array(
      z.object({
        command_id: z.string(),
        ok: z.coerce.boolean(),
        ticket: z.coerce.string().optional(),
        price: num.optional(),
        volume: num.optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  /** Closed candles requested with a "candles" command (bridge EA v2+). */
  candles: z
    .array(
      z.object({
        command_id: z.string(),
        symbol: z.string(),
        timeframe: z.coerce.number().int().positive(),
        /** Broker server time (TimeCurrent) when the bars were read, as a Unix timestamp. */
        server_time: z.coerce.number(),
        bars: z.array(z.tuple([num, num, num, num, num])).max(2000),
        error: z.string().optional(),
      }),
    )
    .default([]),
});

export type Mt5Report = z.infer<typeof mt5ReportSchema>;

export async function ingestMt5Report(account: BrokerAccount, report: Mt5Report): Promise<string> {
  const userId = account.user_id;
  const store = forUser(userId);
  const commands = getStore().commands;
  await store.brokers.update(account.id, {
    login: report.login,
    server: report.server,
    currency: report.currency,
    balance: report.balance,
    equity: report.equity,
    is_demo: report.is_demo,
    status: "connected",
    error: null,
    last_sync_at: nowIso(),
  });
  // First check-in: the account's equity joins its book without counting as profit.
  if (!account.last_sync_at) await adjustBaseline(userId, bookOf(report), report.equity - account.equity);

  // 1. Results of commands sent last time.
  for (const r of report.results) {
    const command = await commands.get(r.command_id);
    if (!command || command.account_id !== account.id) continue;
    await commands.update(command.id, { status: r.ok ? "done" : "failed", result: r });
    if (command.type === "candles") {
      if (!r.ok) await recordCandleError(account, command, r.error ?? "The bridge EA could not read candles");
      continue;
    }
    if (!command.trade_id || command.type !== "open") {
      if (!r.ok) await log("error", `MT5 ${command.type} failed: ${r.error ?? "unknown error"}`, { user_id: userId });
      continue;
    }
    const trade = await store.trades.get(command.trade_id);
    if (!trade) continue;
    if (r.ok) {
      await store.trades.update(trade.id, {
        status: "open",
        broker_ref: r.ticket ?? null,
        entry_price: r.price ?? trade.entry_price,
        size: r.volume ?? trade.size,
      });
      await log("trade", `MT5 filled ${trade.side.toUpperCase()} ${trade.symbol} ${r.volume} lots @ ${r.price}`, {
        user_id: userId,
        bot_id: trade.bot_id,
      });
    } else {
      await store.trades.update(trade.id, { status: "rejected", close_reason: r.error ?? "Rejected by MT5", closed_at: nowIso() });
      await log("error", `MT5 rejected ${trade.symbol}: ${r.error ?? "unknown error"}`, { user_id: userId, bot_id: trade.bot_id });
    }
  }

  // 1b. Candles the EA sent for "candles" commands.
  for (const c of report.candles) {
    const command = await commands.get(c.command_id);
    if (!command || command.account_id !== account.id || command.type !== "candles") continue;
    await commands.update(command.id, { status: c.error ? "failed" : "done", result: { bars: c.bars.length, error: c.error ?? null } });
    if (c.error || !c.bars.length) {
      await recordCandleError(account, command, c.error ?? "No candles returned — is the symbol in Market Watch?");
      continue;
    }
    await saveMarketData(account, c.symbol, c.timeframe, {
      bars: c.bars.slice().sort((a, b) => a[0] - b[0]),
      server_offset: Math.round(c.server_time - Date.now() / 1000),
      error: null,
    });
  }

  // 2. Reconcile positions.
  const active = await store.trades.all({ eq: { broker_account_id: account.id }, in: { field: "status", values: ["pending", "open"] } });
  const byTicket = new Map(report.positions.map((p) => [p.ticket, p]));
  const seen = new Set<string>();

  for (const trade of active) {
    let position = trade.broker_ref ? byTicket.get(trade.broker_ref) : undefined;
    // Link a fill whose result report was lost, via the order comment.
    if (!position && !trade.broker_ref) {
      position = report.positions.find((p) => p.comment === `bt:${trade.id.slice(0, 8)}`);
    }
    if (position) {
      seen.add(position.ticket);
      await store.trades.update(trade.id, {
        status: "open",
        broker_ref: position.ticket,
        entry_price: position.price_open,
        current_price: position.price_current,
        size: position.volume,
        sl: position.sl || null,
        tp: position.tp || null,
        pnl: position.profit,
      });
    } else if (trade.status === "open" && trade.broker_ref) {
      const closing = report.deals.filter((d) => d.position_id === trade.broker_ref);
      const pnl = closing.length ? closing.reduce((s, d) => s + d.profit, 0) : trade.pnl;
      await store.trades.update(trade.id, {
        status: "closed",
        pnl,
        exit_price: closing.at(-1)?.price ?? trade.current_price,
        close_reason: trade.close_reason ?? "Closed on MT5 (stop/target/manual)",
        closed_at: nowIso(),
      });
      await log("trade", `MT5 closed ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`, { user_id: userId, bot_id: trade.bot_id });
    }
  }

  // 3. Positions opened outside binaryTrades (your own EAs or manual trades).
  const bots = await store.bots.all({ eq: { broker_account_id: account.id } });
  for (const p of report.positions) {
    if (seen.has(p.ticket)) continue;
    const bot = bots.find((b) => b.magic === p.magic && p.magic !== 0);
    const trade: Trade = {
      id: newId(),
      user_id: userId,
      bot_id: bot?.id ?? null,
      broker_account_id: account.id,
      book: bookOf(report),
      symbol: p.symbol,
      data_symbol: null,
      side: p.type,
      size: p.volume,
      size_unit: "lots",
      entry_price: p.price_open,
      current_price: p.price_current,
      sl: p.sl || null,
      tp: p.tp || null,
      risk_amount: 0,
      pnl: p.profit,
      status: "open",
      broker_ref: p.ticket,
      magic: p.magic,
      external: !bot,
      close_reason: null,
      exit_price: null,
      opened_at: nowIso(),
      closed_at: null,
    };
    await store.trades.insert(trade);
  }

  // 4. Commands the EA received but never confirmed (e.g. terminal restarted mid-order).
  const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
  for (const c of await commands.all({ eq: { account_id: account.id, status: "sent" } })) {
    if (!c.sent_at || c.sent_at > staleBefore) continue;
    await commands.update(c.id, { status: "failed", result: { error: "No confirmation from the MT5 bridge" } });
    const trade = c.trade_id ? await store.trades.get(c.trade_id) : null;
    if (c.type === "open" && trade?.status === "pending") {
      await store.trades.update(trade.id, { status: "rejected", close_reason: "No confirmation from the MT5 bridge", closed_at: nowIso() });
    }
    await log("warn", `MT5 ${c.type} command was not confirmed by the bridge within 3 minutes`, { user_id: userId, bot_id: trade?.bot_id });
  }

  // 5. Ask for fresh candles for running bots that read prices from this account.
  await requestCandles(account);

  // 6. Hand over queued commands.
  const queued = await commands.all({
    eq: { account_id: account.id, status: "queued" },
    order: { field: "created_at", ascending: true },
  });
  for (const c of queued) await commands.update(c.id, { status: "sent", sent_at: nowIso() });
  return queued.map(formatCommand).join("\n");
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/[|\n\r]/g, " ");
}

export function formatCommand(c: Mt5Command): string {
  const p = c.payload as Record<string, unknown>;
  if (c.type === "candles") return [c.id, c.type, p.symbol, p.timeframe, p.count, "", "", "", "", ""].map(clean).join("|");
  return [c.id, c.type, p.symbol, p.side, p.risk_money, p.sl, p.tp, p.magic, p.ticket, p.comment].map(clean).join("|");
}

// ---------------------------------------------------------------------------
// Broker prices for bots with price_source "broker"

const CANDLE_COUNT = 400;
const REQUEST_EVERY_MS = 30_000;

async function saveMarketData(account: BrokerAccount, symbol: string, timeframe: number, patch: Partial<MarketData>) {
  const store = getStore();
  const id = marketDataId(account.id, symbol, timeframe);
  const existing = await store.market_data.get(id);
  if (existing) {
    await store.market_data.update(id, { ...patch, updated_at: nowIso() });
  } else {
    await store.market_data.insert({
      id,
      user_id: account.user_id,
      account_id: account.id,
      symbol,
      timeframe,
      bars: [],
      server_offset: 0,
      error: null,
      requested_at: null,
      updated_at: nowIso(),
      ...patch,
    });
  }
}

async function recordCandleError(account: BrokerAccount, command: Mt5Command, error: string) {
  const p = command.payload as { symbol?: string; timeframe?: number };
  if (!p.symbol || !p.timeframe) return;
  const message = /unknown command/.test(error)
    ? "Your MT5 bridge EA is out of date — download the latest version from the Brokers page to use MT5 prices."
    : error;
  await saveMarketData(account, p.symbol, p.timeframe, { error: message });
  await log("warn", `MT5 prices for ${p.symbol}: ${message}`, { user_id: account.user_id });
}

/** True when a newer closed bar should exist than the latest one stored. */
export function candlesDue(data: MarketData | null, timeframe: number, now = Date.now()): boolean {
  if (!data?.bars.length) return true;
  const lastEpoch = data.bars[data.bars.length - 1]![0];
  const serverNow = now / 1000 + data.server_offset;
  // The bar after the last stored one closes at lastEpoch + 2 × timeframe.
  return serverNow >= lastEpoch + 2 * timeframe;
}

async function requestCandles(account: BrokerAccount) {
  const store = getStore();
  const bots: Bot[] = await forUser(account.user_id).bots.all({
    eq: { broker_account_id: account.id, status: "running", source: "builtin", price_source: "broker" },
  });
  const wanted = new Map(bots.map((b) => [marketDataId(account.id, b.symbol, b.timeframe), b]));
  for (const [id, bot] of wanted) {
    const data = await store.market_data.get(id);
    if (!candlesDue(data, bot.timeframe)) continue;
    if (data?.requested_at && Date.now() - Date.parse(data.requested_at) < REQUEST_EVERY_MS) continue;
    await saveMarketData(account, bot.symbol, bot.timeframe, { requested_at: nowIso() });
    await store.commands.insert({
      id: newId(),
      account_id: account.id,
      trade_id: null,
      type: "candles",
      payload: { symbol: bot.symbol, timeframe: bot.timeframe, count: CANDLE_COUNT },
      status: "queued",
      result: null,
      created_at: nowIso(),
      sent_at: null,
    });
  }
}
