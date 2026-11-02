import "server-only";

import { derivCandles, derivClose, derivOpen, derivSnapshot, type Candle, type DerivCredentials } from "@/lib/brokers/deriv";
import { decryptSecret } from "@/lib/secrets";
import { atrSeries, getStrategy } from "@/lib/strategies";
import { resolveLevels } from "@/lib/strategies/backtest";
import { SCRIPT_STRATEGY_ID, scriptStrategy, type ScriptContext } from "@/lib/strategies/script";
import { advanceBookState, checkRisk, derivStake } from "@/lib/trading/risk";
import { dayKey, forUser, getSettings, getStore, log, newId, nowIso, updateSettings } from "@/lib/trading/store";
import type { Book, Bot, BrokerAccount, Side, Signal, SignalAction, Trade } from "@/lib/trading/types";

/** External calls, swappable in tests. */
export const deps = {
  candles: derivCandles,
  derivOpen,
  derivClose,
  derivSnapshot,
};

const ACTIVE: Trade["status"][] = ["pending", "open"];

// ---------------------------------------------------------------------------
// Prices

const priceCache = new Map<string, { price: number; at: number }>();

export async function latestPrice(dataSymbol: string): Promise<number | null> {
  const cached = priceCache.get(dataSymbol);
  if (cached && Date.now() - cached.at < 5000) return cached.price;
  try {
    const candles = await deps.candles(dataSymbol, 60, 1);
    const price = candles.at(-1)?.close ?? null;
    if (price !== null) priceCache.set(dataSymbol, { price, at: Date.now() });
    return price;
  } catch {
    return cached?.price ?? null;
  }
}

// ---------------------------------------------------------------------------
// Equity and book state

/** One user's open and pending trades, optionally filtered further. */
export async function activeTrades(userId: string, filter: Partial<Trade> = {}): Promise<Trade[]> {
  return forUser(userId).trades.all({ eq: filter, in: { field: "status", values: ACTIVE } });
}

/** Token, App ID and account for a connected Deriv account. */
export function derivCredentials(broker: BrokerAccount): DerivCredentials {
  if (!broker.encrypted_token || !broker.app_id || !broker.login) {
    throw new Error(`${broker.label} needs reconnecting with a Deriv token and App ID`);
  }
  return { token: decryptSecret(broker.encrypted_token), appId: broker.app_id, accountId: broker.login };
}

/** Real or demo money is decided by the broker account, never by a setting in binaryTrades. */
export function bookOf(broker: Pick<BrokerAccount, "is_demo">): Book {
  return broker.is_demo ? "demo" : "real";
}

export async function bookEquity(userId: string, book: Book): Promise<number> {
  // Last known equity of every account, connected or not: a terminal going
  // offline must not look like a 100% drawdown and fire the kill switch.
  const brokers = await forUser(userId).brokers.all();
  return brokers.filter((b) => bookOf(b) === book).reduce((sum, b) => sum + b.equity, 0);
}

/** Bots trading on accounts of the given kind. */
async function botsInBook(userId: string, book: Book, filter: Partial<Bot> = {}): Promise<Bot[]> {
  const store = forUser(userId);
  const ids = new Set((await store.brokers.all()).filter((b) => bookOf(b) === book).map((b) => b.id));
  return (await store.bots.all({ eq: filter })).filter((b) => b.broker_account_id && ids.has(b.broker_account_id));
}

/**
 * Shift a book's day-start and peak when an account joins or leaves, so
 * adding a broker isn't counted as profit and removing one as a loss.
 */
export async function adjustBaseline(userId: string, book: Book, delta: number): Promise<void> {
  if (!delta) return;
  const settings = await getSettings(userId);
  const state = settings.books[book];
  await updateSettings(userId, {
    books: {
      ...settings.books,
      [book]: {
        ...state,
        peak_equity: Math.max(0, state.peak_equity + delta),
        day_start_equity: Math.max(0, state.day_start_equity + delta),
      },
    },
  });
}

async function refreshBook(userId: string, book: Book) {
  const settings = await getSettings(userId);
  const equity = await bookEquity(userId, book);
  const state = advanceBookState(settings.books[book], equity, dayKey());
  if (JSON.stringify(state) !== JSON.stringify(settings.books[book])) {
    await updateSettings(userId, { books: { ...settings.books, [book]: state } });
  }
  return { equity, state };
}

// ---------------------------------------------------------------------------
// Opening trades

interface OpenRequest {
  side: Side;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  /** Used when the signal has no explicit SL price (built-in strategies: ATR × multiple). */
  stopDistance?: number | null;
  /** Reward:risk used with stopDistance when no explicit TP is given. */
  rr?: number | null;
}

export async function openTrade(
  bot: Bot,
  req: OpenRequest,
): Promise<{ ok: true; trade: Trade } | { ok: false; reason: string }> {
  const userId = bot.user_id;
  const store = forUser(userId);
  const broker = bot.broker_account_id ? await store.brokers.get(bot.broker_account_id) : null;
  if (!broker) return { ok: false, reason: "Bot has no broker account — choose one on the Bots page" };
  if (broker.status !== "connected") return { ok: false, reason: `${broker.label} is not connected` };

  const book = bookOf(broker);
  const settings = await getSettings(userId);
  const { state } = await refreshBook(userId, book);
  const decision = checkRisk({
    settings,
    book,
    bot,
    // Size from this account's own equity; limits use the whole book.
    equity: broker.equity,
    bookState: state,
    bookEquity: await bookEquity(userId, book),
    openTradesInBook: (await activeTrades(userId, { book })).length,
    openTradesForBot: (await activeTrades(userId, { bot_id: bot.id })).length,
  });

  if (!decision.ok) {
    if (decision.breach) await handleBreach(userId, book, decision.breach, decision.reason);
    return { ok: false, reason: decision.reason };
  }

  const dir = req.side === "buy" ? 1 : -1;
  const price = req.price ?? (await latestPrice(bot.data_symbol));
  let sl = req.sl ?? null;
  let tp = req.tp ?? null;
  if (price && sl === null && req.stopDistance) sl = price - dir * req.stopDistance;
  // Reward:risk targets are measured from the actual stop (the strategy's own, or the ATR stop).
  if (price && tp === null && req.rr && sl !== null) tp = price + dir * req.rr * Math.abs(price - sl);
  const stopDistance = price && sl !== null ? Math.abs(price - sl) : null;

  const base: Trade = {
    id: newId(),
    user_id: userId,
    bot_id: bot.id,
    broker_account_id: broker.id,
    book,
    symbol: bot.symbol,
    data_symbol: bot.data_symbol,
    side: req.side,
    size: 0,
    size_unit: broker.kind === "deriv" ? "stake" : "lots",
    entry_price: price ?? null,
    current_price: price ?? null,
    sl,
    tp,
    risk_amount: decision.riskAmount,
    pnl: 0,
    status: "pending",
    broker_ref: null,
    magic: bot.magic,
    external: false,
    close_reason: null,
    exit_price: null,
    opened_at: nowIso(),
    closed_at: null,
  };

  if (broker.kind === "deriv") {
    const { stake, stopLossAmount } = derivStake({
      riskAmount: decision.riskAmount,
      entry: price ?? 0,
      stopDistance,
      multiplier: bot.deriv_multiplier,
      equity: broker.equity,
    });
    const takeProfitAmount =
      price && tp !== null ? (stake * bot.deriv_multiplier * Math.abs(tp - price)) / price : undefined;
    try {
      const res = await deps.derivOpen(derivCredentials(broker), {
        symbol: bot.symbol,
        side: req.side,
        stake,
        multiplier: bot.deriv_multiplier,
        currency: broker.currency,
        stopLossAmount,
        takeProfitAmount,
      });
      const trade: Trade = {
        ...base,
        status: "open",
        size: res.buy_price,
        size_unit: "stake",
        broker_ref: res.contract_id,
        entry_price: res.entry_spot ?? price ?? null,
      };
      await store.trades.insert(trade);
      await log("trade", `DERIV ${req.side.toUpperCase()} ${bot.symbol} stake ${res.buy_price} ×${bot.deriv_multiplier}`, {
        user_id: userId,
        bot_id: bot.id,
        context: { contract_id: res.contract_id },
      });
      return { ok: true, trade };
    } catch (error) {
      const reason = `Deriv rejected the order: ${(error as Error).message}`;
      await store.trades.insert({ ...base, status: "rejected", close_reason: reason, closed_at: nowIso() });
      await log("error", reason, { user_id: userId, bot_id: bot.id });
      return { ok: false, reason };
    }
  }

  // MT5: queue for the bridge EA, which sizes the lot from risk_money and the stop.
  const trade: Trade = { ...base, size_unit: "lots" };
  await store.trades.insert(trade);
  await getStore().commands.insert({
    id: newId(),
    account_id: broker.id,
    trade_id: trade.id,
    type: "open",
    payload: {
      symbol: bot.symbol,
      side: req.side,
      risk_money: Number(decision.riskAmount.toFixed(2)),
      sl: sl ?? 0,
      tp: tp ?? 0,
      magic: bot.magic,
      comment: `bt:${trade.id.slice(0, 8)}`,
    },
    status: "queued",
    result: null,
    created_at: nowIso(),
    sent_at: null,
  });
  await log("trade", `MT5 ${req.side.toUpperCase()} ${bot.symbol} queued for ${broker.label}`, { user_id: userId, bot_id: bot.id });
  return { ok: true, trade };
}

// ---------------------------------------------------------------------------
// Closing trades

export async function closeTrade(trade: Trade, reason: string): Promise<Trade> {
  const userId = trade.user_id;
  const store = forUser(userId);
  const commands = getStore().commands;
  if (!ACTIVE.includes(trade.status)) return trade;

  const broker = trade.broker_account_id ? await store.brokers.get(trade.broker_account_id) : null;
  if (!broker) throw new Error("This trade's broker account is no longer connected — close it in your broker's app");

  if (broker.kind === "deriv") {
    const res = await deps.derivClose(derivCredentials(broker), trade.broker_ref!);
    const pnl = res.profit ?? res.sold_for - trade.size;
    const closed = await store.trades.update(trade.id, {
      status: "closed",
      pnl,
      exit_price: res.exit_spot ?? trade.current_price,
      close_reason: res.commission ? `${reason} · incl. Deriv commission ${res.commission.toFixed(2)}` : reason,
      closed_at: nowIso(),
    });
    await log("trade", `DERIV close ${trade.symbol} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${reason})`, {
      user_id: userId,
      bot_id: trade.bot_id,
    });
    return closed!;
  }

  // MT5
  if (trade.status === "pending") {
    const queued = await commands.all({ eq: { trade_id: trade.id, status: "queued" } });
    if (queued.length) {
      for (const c of queued) await commands.update(c.id, { status: "failed", result: { error: "cancelled" } });
      return (await store.trades.update(trade.id, { status: "rejected", close_reason: `Cancelled: ${reason}`, closed_at: nowIso() }))!;
    }
  }
  await commands.insert({
    id: newId(),
    account_id: broker.id,
    trade_id: trade.id,
    type: "close",
    payload: { ticket: trade.broker_ref ?? "", comment: `bt:${trade.id.slice(0, 8)}` },
    status: "queued",
    result: null,
    created_at: nowIso(),
    sent_at: null,
  });
  await log("trade", `MT5 close ${trade.symbol} queued (${reason})`, { user_id: userId, bot_id: trade.bot_id });
  return (await store.trades.update(trade.id, { close_reason: reason }))!;
}

export async function setKillSwitch(userId: string, on: boolean, reason = "Kill switch pressed"): Promise<void> {
  const store = forUser(userId);
  await updateSettings(userId, { kill_switch: on });
  if (!on) {
    await log("warn", "Kill switch released — bots stay paused until you start them", { user_id: userId });
    return;
  }
  for (const bot of await store.bots.all({ eq: { status: "running" } })) {
    await store.bots.update(bot.id, { status: "paused", paused_reason: reason });
  }
  for (const trade of await activeTrades(userId)) {
    try {
      await closeTrade(trade, reason);
    } catch (error) {
      await log("error", `Could not close ${trade.symbol}: ${(error as Error).message}`, { user_id: userId, bot_id: trade.bot_id });
    }
  }
  // Also flatten positions binaryTrades does not track (e.g. your own EAs).
  for (const broker of await store.brokers.all({ eq: { kind: "mt5" } })) {
    await getStore().commands.insert({
      id: newId(),
      account_id: broker.id,
      trade_id: null,
      type: "close_all",
      payload: {},
      status: "queued",
      result: null,
      created_at: nowIso(),
      sent_at: null,
    });
  }
  await log("error", `KILL SWITCH: ${reason}. All bots paused, all positions closing.`, { user_id: userId });
}

async function handleBreach(userId: string, book: Book, breach: "daily_loss" | "drawdown", reason: string) {
  const store = forUser(userId);
  // A drawdown on real money stops everything; demo accounts never touch real trading.
  if (breach === "drawdown" && book === "real") {
    await setKillSwitch(userId, true, reason);
    return;
  }
  const running = await botsInBook(userId, book, { status: "running" });
  if (!running.length) return;
  for (const bot of running) await store.bots.update(bot.id, { status: "paused", paused_reason: reason });
  await log("warn", `${reason} — paused ${running.length} ${book}-account bot(s) until you restart them`, { user_id: userId });
}

// ---------------------------------------------------------------------------
// Signals (TradingView, manual, built-in strategies)

export interface SignalInput {
  bot: Bot;
  source: Signal["source"];
  action: SignalAction;
  price?: number | null;
  sl?: number | null;
  tp?: number | null;
  external_id?: string | null;
  stopDistance?: number | null;
  rr?: number | null;
}

export async function processSignal(input: SignalInput): Promise<Signal> {
  const { bot } = input;
  const userId = bot.user_id;
  const store = forUser(userId);

  const record = async (status: Signal["status"], reason: string | null): Promise<Signal> => {
    const signal: Signal = {
      id: newId(),
      user_id: userId,
      bot_id: bot.id,
      source: input.source,
      action: input.action,
      symbol: bot.symbol,
      price: input.price ?? null,
      sl: input.sl ?? null,
      tp: input.tp ?? null,
      external_id: input.external_id ?? null,
      status,
      reason,
      received_at: nowIso(),
    };
    await store.signals.insert(signal);
    if (status === "rejected") await log("warn", `${bot.name}: ${input.action} signal rejected — ${reason}`, { user_id: userId, bot_id: bot.id });
    return signal;
  };

  if (input.external_id) {
    const dup = await store.signals.all({ eq: { bot_id: bot.id, external_id: input.external_id }, limit: 1 });
    if (dup.length) return record("duplicate", "Already processed");
  }
  await store.bots.update(bot.id, { last_signal_at: nowIso() });

  const settings = await getSettings(userId);
  if (settings.kill_switch) return record("rejected", "Kill switch is on");
  if (bot.status !== "running") return record("rejected", "Bot is paused");

  const open = await activeTrades(userId, { bot_id: bot.id });

  if (input.action === "close") {
    for (const t of open) await closeTrade(t, "Close signal");
    return record("accepted", open.length ? null : "Nothing to close");
  }

  for (const t of open.filter((t) => t.side !== input.action)) await closeTrade(t, "Reversed by opposite signal");
  if (open.some((t) => t.side === input.action)) return record("rejected", `Already ${input.action === "buy" ? "long" : "short"}`);

  const result = await openTrade(bot, {
    side: input.action,
    price: input.price,
    sl: input.sl,
    tp: input.tp,
    stopDistance: input.stopDistance,
    rr: input.rr,
  });
  return result.ok ? record("accepted", null) : record("rejected", result.reason);
}

// ---------------------------------------------------------------------------
// Periodic engine tick: sync brokers, run built-in bots, enforce limits

function closedCandles(candles: Candle[], timeframe: number): Candle[] {
  const now = Date.now() / 1000;
  return candles.filter((c) => c.epoch + timeframe <= now);
}

export async function syncDerivAccount(broker: BrokerAccount): Promise<void> {
  const store = forUser(broker.user_id);
  try {
    const tracked = await activeTrades(broker.user_id, { broker_account_id: broker.id });
    const snap = await deps.derivSnapshot(
      derivCredentials(broker),
      tracked.map((t) => t.broker_ref!).filter(Boolean),
    );
    await store.brokers.update(broker.id, {
      balance: snap.balance,
      equity: snap.equity,
      currency: snap.currency,
      status: "connected",
      error: null,
      last_sync_at: nowIso(),
    });
    for (const c of snap.contracts) {
      const trade = tracked.find((t) => t.broker_ref === c.contract_id);
      if (trade) {
        await store.trades.update(trade.id, {
          pnl: c.profit,
          current_price: c.current_spot,
          entry_price: trade.entry_price ?? c.entry_spot,
          ...(c.is_sold
            ? {
                status: "closed" as const,
                exit_price: c.exit_spot,
                closed_at: nowIso(),
                close_reason:
                  trade.close_reason ??
                  `Closed on Deriv (stop/target)${c.commission ? ` · incl. Deriv commission ${c.commission.toFixed(2)}` : ""}`,
              }
            : {}),
        });
      } else if (!c.is_sold) {
        await store.trades.insert({
          id: newId(),
          user_id: broker.user_id,
          bot_id: null,
          broker_account_id: broker.id,
          book: bookOf(broker),
          symbol: c.symbol,
          data_symbol: c.symbol,
          side: c.side,
          size: c.stake,
          size_unit: "stake",
          entry_price: c.entry_spot,
          current_price: c.current_spot,
          sl: null,
          tp: null,
          risk_amount: 0,
          pnl: c.profit,
          status: "open",
          broker_ref: c.contract_id,
          magic: null,
          external: true,
          close_reason: null,
          exit_price: null,
          opened_at: nowIso(),
          closed_at: null,
        });
      }
    }
  } catch (error) {
    await store.brokers.update(broker.id, { status: "error", error: (error as Error).message, last_sync_at: nowIso() });
  }
}

/** What a script sees about its live account and position. */
export async function scriptContext(bot: Bot): Promise<ScriptContext> {
  const store = forUser(bot.user_id);
  const broker = bot.broker_account_id ? await store.brokers.get(bot.broker_account_id) : null;
  const [open] = await activeTrades(bot.user_id, { bot_id: bot.id });
  return {
    live: true,
    account: broker
      ? { broker: broker.kind, balance: broker.balance, equity: broker.equity, currency: broker.currency, is_demo: broker.is_demo }
      : null,
    broker_position: open ? { side: open.side, entry: open.entry_price, size: open.size, pnl: open.pnl } : null,
  };
}

/**
 * Closed candles for a bot: from its own MT5 broker when price_source is "broker"
 * (null while the bridge EA hasn't sent them yet), otherwise from Deriv.
 */
export async function botCandles(bot: Bot, count = 400): Promise<Candle[] | null> {
  if (bot.price_source === "broker" && bot.broker_account_id) {
    const broker = await forUser(bot.user_id).brokers.get(bot.broker_account_id);
    if (broker?.kind === "mt5") {
      const data = await getStore().market_data.get(marketDataId(broker.id, bot.symbol, bot.timeframe));
      if (!data?.bars.length) return null;
      // The EA sends closed bars only, stamped in broker server time.
      return data.bars.slice(-count).map(([epoch, open, high, low, close]) => ({ epoch, open, high, low, close }));
    }
  }
  return closedCandles(await deps.candles(bot.data_symbol, bot.timeframe, count), bot.timeframe);
}

export function marketDataId(accountId: string, symbol: string, timeframe: number): string {
  return `${accountId}:${symbol}:${timeframe}`;
}

export async function runBuiltinBot(bot: Bot): Promise<string> {
  const store = forUser(bot.user_id);
  const isScript = bot.strategy?.id === SCRIPT_STRATEGY_ID && Boolean(bot.strategy.code);
  const script = isScript ? await scriptStrategy(bot.strategy!.code!, bot.name, await scriptContext(bot)) : null;
  const def = script ?? (bot.strategy ? getStrategy(bot.strategy.id) : undefined);
  if (!def || !bot.strategy) return "no strategy";

  const candles = await botCandles(bot);
  if (!candles) return "waiting for MT5 prices";
  const last = candles.at(-1);
  if (!last || candles.length < 210) return "not enough data";
  if (bot.last_bar_epoch === last.epoch) return "waiting for next bar";
  await store.bots.update(bot.id, { last_bar_epoch: last.epoch });

  const params = bot.strategy.params;
  let positions: Int8Array;
  let levels: ReturnType<NonNullable<typeof def.levels>> | undefined;
  try {
    positions = def.positions(candles, params);
    levels = def.levels?.(candles, params);
  } catch (error) {
    if (def.id !== SCRIPT_STRATEGY_ID) throw error;
    // A broken script must not keep failing every bar: pause the bot and say why.
    const reason = `Script error — ${(error as Error).message}`;
    await store.bots.update(bot.id, { status: "paused", paused_reason: reason.slice(0, 300) });
    await log("error", `${bot.name} paused: ${reason}`, { user_id: bot.user_id, bot_id: bot.id });
    return "paused: script error";
  }
  const want = positions[positions.length - 1];
  const prev = positions[positions.length - 2];
  // A script can ask to close the current trade and open a fresh one on this bar.
  const restart = want !== 0 && Boolean(levels?.get(candles.length - 1)?.restart);
  // Scripts that also handle TradingView alerts act on bars only when onBar changes its mind,
  // so a position opened by an alert isn't closed just because onBar is flat.
  if (script) {
    const run = script.run(candles, params);
    if (!run.hasOnBar) return "alerts only";
    if (run.hasOnAlert && want === prev && !restart) return "hold";
  }
  const open = await activeTrades(bot.user_id, { bot_id: bot.id });
  const current = open[0];
  let currentDir = current ? (current.side === "buy" ? 1 : -1) : 0;

  if (current && (want !== currentDir || restart)) {
    await processSignal({ bot, source: "builtin", action: "close" });
    if (want === 0) return "closed";
    currentDir = (await activeTrades(bot.user_id, { bot_id: bot.id })).length ? currentDir : 0;
  }
  if (want !== 0 && (want !== prev || restart) && want !== currentDir) {
    const atr = atrSeries(candles).at(-1)!;
    // The script's own stop / target, when it set them on the correct side of the price.
    const own = resolveLevels(want as 1 | -1, last.close, levels?.get(candles.length - 1));
    await processSignal({
      bot,
      source: "builtin",
      action: want === 1 ? "buy" : "sell",
      // Bots on broker prices measure stop and target from the broker's own last close.
      price: bot.price_source === "broker" ? last.close : undefined,
      sl: own.stop,
      tp: own.target,
      stopDistance: atr * (params.atr_mult ?? 2),
      rr: params.rr ?? 0,
    });
    return want === 1 ? "buy" : "sell";
  }
  return "hold";
}

let tickInFlight: Promise<TickReport> | null = null;

export interface TickReport {
  at: string;
  users: number;
  bots: Record<string, string>;
}

/** Called every minute by an open dashboard and/or an external cron; runs every user's bots. */
export function runEngineTick(): Promise<TickReport> {
  if (!tickInFlight) tickInFlight = doTick().finally(() => (tickInFlight = null));
  return tickInFlight;
}

const lastEquityPoint = new Map<string, number>();

async function doTick(): Promise<TickReport> {
  const store = getStore();
  const report: TickReport = { at: nowIso(), users: 0, bots: {} };
  const active = new Set([...(await store.brokers.all()).map((b) => b.user_id), ...(await store.bots.all()).map((b) => b.user_id)]);
  const disabled = new Set((await store.users.all({ eq: { disabled: true } })).map((u) => u.id));
  for (const userId of active) {
    if (disabled.has(userId)) continue;
    report.users++;
    try {
      Object.assign(report.bots, await tickUser(userId));
    } catch (error) {
      await log("error", `Engine error: ${(error as Error).message}`, { user_id: userId });
    }
  }
  return report;
}

/** One user's share of the engine tick. Bot names in the report are prefixed with the user id. */
export async function tickUser(userId: string): Promise<Record<string, string>> {
  const store = forUser(userId);
  const bots: Record<string, string> = {};

  for (const broker of await store.brokers.all()) {
    if (broker.kind === "deriv") await syncDerivAccount(broker);
    else if (broker.status === "connected" && broker.last_sync_at && Date.now() - Date.parse(broker.last_sync_at) > 120_000) {
      await store.brokers.update(broker.id, { status: "waiting", error: "MT5 bridge has not checked in for 2 minutes" });
    }
  }

  const settings = await getSettings(userId);
  if (!settings.kill_switch) {
    for (const bot of await store.bots.all({ eq: { status: "running", source: "builtin" } })) {
      const key = `${userId.slice(0, 8)}:${bot.name}`;
      try {
        bots[key] = await runBuiltinBot(bot);
      } catch (error) {
        bots[key] = `error: ${(error as Error).message}`;
        await log("error", `${bot.name}: ${(error as Error).message}`, { user_id: userId, bot_id: bot.id });
      }
    }
  }

  for (const book of ["real", "demo"] as const) {
    const { equity, state } = await refreshBook(userId, book);
    if (equity <= 0) continue;
    const s = await getSettings(userId);
    const label = book === "real" ? "Real" : "Demo";
    if (s.max_drawdown_percent > 0 && state.peak_equity > 0 && !s.kill_switch) {
      const dd = ((state.peak_equity - equity) / state.peak_equity) * 100;
      if (dd >= s.max_drawdown_percent) {
        await handleBreach(userId, book, "drawdown", `${label}-account drawdown ${dd.toFixed(1)}% hit the ${s.max_drawdown_percent}% limit`);
      }
    }
    if (s.daily_loss_limit > 0 && state.day_start_equity - equity >= s.daily_loss_limit) {
      await handleBreach(userId, book, "daily_loss", `${label}-account daily loss limit of ${s.daily_loss_limit} reached`);
    }
    const key = `${userId}:${book}`;
    if (Date.now() - (lastEquityPoint.get(key) ?? 0) > 5 * 60_000) {
      lastEquityPoint.set(key, Date.now());
      await store.equity.insert({ id: newId(), user_id: userId, book, equity, created_at: nowIso() });
    }
  }
  return bots;
}
