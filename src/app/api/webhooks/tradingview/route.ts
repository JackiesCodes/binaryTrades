import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { jsonError, zodError } from "@/lib/http";
import { resolveLevels } from "@/lib/strategies/backtest";
import { SCRIPT_STRATEGY_ID, ScriptError, runScriptAlert } from "@/lib/strategies/script";
import { botCandles, latestPrice, processSignal, scriptContext } from "@/lib/trading/engine";
import { forUser, getStore, log, newId, nowIso } from "@/lib/trading/store";
import type { Bot, Signal } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * TradingView alert webhook. TradingView cannot sign requests or set
 * headers, so each bot has its own passphrase that must be in the JSON body.
 * Alert message template (shown per bot on the Bots page):
 *
 *   {"bot_id":"…","passphrase":"…","action":"{{strategy.order.action}}",
 *    "price":{{close}},"id":"{{timenow}}"}
 *
 * Optional: "sl", "tp" (prices). "action" accepts buy / sell / close
 * (plus long / short / exit / flat aliases).
 *
 * Script bots whose script defines onAlert(alert, i) receive the whole alert
 * (every field except the passphrase) and decide what to do; "action" is
 * then optional.
 */
const ACTIONS: Record<string, "buy" | "sell" | "close"> = {
  buy: "buy",
  long: "buy",
  sell: "sell",
  short: "sell",
  close: "close",
  exit: "close",
  flat: "close",
};

const schema = z
  .object({
    bot_id: z.string().min(1),
    passphrase: z.string().min(1),
    action: z.string().optional(),
    price: z.coerce.number().positive().optional(),
    sl: z.coerce.number().positive().optional(),
    tp: z.coerce.number().positive().optional(),
    id: z.coerce.string().optional(),
  })
  .passthrough();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 20_000) return jsonError(413, "ALERT_TOO_LARGE");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "BODY_MUST_BE_JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;

  const bot = await getStore().bots.get(input.bot_id);
  if (!bot || !safeEqual(bot.webhook_passphrase, input.passphrase)) {
    if (bot) await log("warn", "TradingView webhook with a wrong passphrase ignored", { user_id: bot.user_id, bot_id: bot.id });
    return jsonError(401, "INVALID_BOT_OR_PASSPHRASE");
  }
  const owner = await getStore().users.get(bot.user_id);
  if (!owner || owner.disabled) return jsonError(403, "ACCOUNT_DISABLED");

  const action = input.action ? ACTIONS[input.action.trim().toLowerCase()] : undefined;
  const isScript = bot.strategy?.id === SCRIPT_STRATEGY_ID && Boolean(bot.strategy.code);

  if (isScript) {
    const { passphrase: _secret, bot_id: _bot, ...alert } = input;
    void _secret;
    void _bot;
    const handled = await viaScript(bot, alert);
    if (handled) return NextResponse.json({ status: handled.status, reason: handled.reason });
  }

  if (!action) return jsonError(400, "UNKNOWN_ACTION");
  const signal = await processSignal({
    bot,
    source: "tradingview",
    action,
    price: input.price,
    sl: input.sl,
    tp: input.tp,
    external_id: input.id ?? null,
  });
  // Always 200 for authenticated requests so TradingView doesn't retry rejected-by-risk signals.
  return NextResponse.json({ status: signal.status, reason: signal.reason });
}

/**
 * Lets a script's onAlert(alert, i) decide. Returns null when the script has no
 * onAlert, so the alert is handled the standard way.
 */
async function viaScript(bot: Bot, alert: Record<string, unknown>): Promise<Pick<Signal, "status" | "reason"> | null> {
  const store = forUser(bot.user_id);
  const externalId = typeof alert.id === "string" ? alert.id : null;
  if (externalId && (await store.signals.all({ eq: { bot_id: bot.id, external_id: externalId }, limit: 1 })).length) {
    return { status: "duplicate", reason: "Already processed" };
  }

  let decision;
  let candles;
  try {
    candles = await botCandles(bot, 400);
    if (!candles?.length) return { status: "rejected", reason: "No price data for this bot yet" };
    decision = await runScriptAlert(bot.strategy!.code!, candles, bot.strategy!.params, await scriptContext(bot), alert);
  } catch (error) {
    if (error instanceof ScriptError && /no onAlert/.test(error.message)) return null;
    const reason = `Script error in onAlert — ${(error as Error).message}`;
    await log("error", `${bot.name}: ${reason}`, { user_id: bot.user_id, bot_id: bot.id });
    return { status: "rejected", reason };
  }

  if (decision.action === null) {
    await store.signals.insert({
      id: newId(),
      user_id: bot.user_id,
      bot_id: bot.id,
      source: "tradingview",
      action: "close",
      symbol: bot.symbol,
      price: typeof alert.price === "number" ? alert.price : null,
      sl: null,
      tp: null,
      external_id: externalId,
      status: "ignored",
      reason: decision.logs.at(-1) ?? "The script chose not to trade this alert",
      received_at: nowIso(),
    });
    return { status: "ignored", reason: "The script chose not to trade this alert" };
  }

  const side = decision.action === 1 ? "buy" : decision.action === -1 ? "sell" : "close";
  const price = Number(alert.price) > 0 ? Number(alert.price) : bot.price_source === "broker" ? candles.at(-1)!.close : await latestPrice(bot.data_symbol);
  const own = side === "close" || !price ? { stop: null, target: null } : resolveLevels(decision.action as 1 | -1, price, decision);
  const atr = bot.strategy!.params.atr_mult ?? 2;
  const signal = await processSignal({
    bot,
    source: "tradingview",
    action: side,
    price,
    sl: own.stop,
    tp: own.target,
    // Without a stop from the script, use the bot's ATR stop like on bars.
    stopDistance: own.stop === null ? atrOf(candles) * atr : null,
    rr: bot.strategy!.params.rr ?? 0,
    external_id: externalId,
  });
  return { status: signal.status, reason: signal.reason };
}

function atrOf(candles: { high: number; low: number; close: number }[], n = 14): number {
  const tr = candles.map((c, i) => (i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1]!.close), Math.abs(c.low - candles[i - 1]!.close))));
  const recent = tr.slice(-n);
  return recent.reduce((s, v) => s + v, 0) / (recent.length || 1);
}
