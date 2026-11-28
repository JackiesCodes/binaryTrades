import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";
import { getStrategy } from "@/lib/strategies";
import { runBacktest } from "@/lib/strategies/backtest";
import { SCRIPT_STRATEGY_ID, ScriptError, scriptStrategy } from "@/lib/strategies/script";
import { botCandles } from "@/lib/trading/engine";
import { inTradingHours } from "@/lib/trading/hours";
import { forUser } from "@/lib/trading/store";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Candles the preview runs over (the chart shows about as many). */
const PREVIEW_BARS = 1000;

/**
 * How this bot trades its market: its own strategy, settings, risk and trading hours run over the
 * latest candles, like the backtester. Each trade comes with its entry, exit, stop and target, and
 * a trade still open at the last candle is what the bot's strategy is holding now.
 */
export const GET = withUser<{ params: { id: string } }>(async (user, _request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "NOT_FOUND");
  if (!bot.strategy) return jsonError(422, "NO_STRATEGY", "This bot trades TradingView alerts, so there's no strategy to draw.");

  let def;
  try {
    def = bot.strategy.id === SCRIPT_STRATEGY_ID ? await scriptStrategy(bot.strategy.code ?? "", bot.name) : getStrategy(bot.strategy.id);
  } catch (error) {
    if (error instanceof ScriptError) return jsonError(422, "SCRIPT_ERROR", error.message);
    throw error;
  }
  if (!def) return jsonError(422, "NO_STRATEGY", "This bot's strategy isn't available.");

  let candles;
  try {
    candles = await botCandles(bot, PREVIEW_BARS);
  } catch (error) {
    return jsonError(502, "MARKET_DATA_UNAVAILABLE", (error as Error).message);
  }
  if (!candles) return jsonError(422, "NO_PRICES", "Waiting for prices from the MT5 bridge.");
  if (candles.length < 50) return jsonError(422, "NOT_ENOUGH_HISTORY");

  // The live bot acts on the latest closed candle straight away, at the current price. The backtester
  // enters "at the next candle's open", so give it the candle forming now, flat at the latest close:
  // a setup on the latest candle then shows as the trade the bot is opening now.
  const lastBar = candles.at(-1)!;
  candles = [...candles, { epoch: lastBar.epoch + bot.timeframe, open: lastBar.close, high: lastBar.close, low: lastBar.close, close: lastBar.close }];

  const broker = bot.broker_account_id ? await store.brokers.get(bot.broker_account_id) : null;
  const hours = bot.trading_hours ?? null;
  const result = runBacktest(candles, def, bot.strategy.params ?? {}, {
    initialBalance: broker?.equity && broker.equity > 0 ? broker.equity : 10_000,
    riskPercent: bot.risk_percent,
    riskAmount: bot.risk_amount ?? undefined,
    costPercent: 0.02,
    timeframe: bot.timeframe,
    canOpen: hours ? (epoch) => inTradingHours(hours, new Date(epoch * 1000)) : undefined,
  });
  const last = result.trades.at(-1);
  return NextResponse.json(
    {
      bot: { id: bot.id, name: bot.name, timeframe: bot.timeframe, data_symbol: bot.data_symbol },
      range: { from: candles[0]!.epoch, to: lastBar.epoch, bars: candles.length - 1 },
      metrics: result.metrics,
      trades: result.trades.slice(-300),
      // Still open at the last candle: what the strategy holds now.
      open: last && last.reason === "end" ? last : null,
      currency: broker?.currency ?? "USD",
    },
    { headers: { "cache-control": "private, no-store" } },
  );
});
