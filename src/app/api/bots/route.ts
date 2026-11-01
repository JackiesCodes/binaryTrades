import { NextResponse } from "next/server";
import { z } from "zod";

import { needsVerifiedEmail, withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { randomToken } from "@/lib/secrets";
import { defaultParams, getStrategy } from "@/lib/strategies";
import { MAX_SCRIPT_LENGTH, SCRIPT_STRATEGY_ID, ScriptError, checkScript } from "@/lib/strategies/script";
import { guessDataSymbol } from "@/lib/trading/symbols";
import { forUser, getSettings, log, newId, nowIso } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const botInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  source: z.enum(["builtin", "tradingview"]),
  broker_account_id: z.string().min(1),
  symbol: z.string().trim().min(1).max(30),
  data_symbol: z.string().trim().max(30).optional(),
  timeframe: z.coerce.number().int().positive().default(3600),
  strategy_id: z.string().optional(),
  strategy_params: z.record(z.coerce.number()).optional(),
  risk_percent: z.coerce.number().min(0.1).max(5).default(1),
  deriv_multiplier: z.coerce.number().int().min(1).max(5000).default(100),
  /** "broker": read candles from the bot's own MT5 account (bridge EA). */
  price_source: z.enum(["deriv", "broker"]).default("deriv"),
  /** JavaScript source, for strategy_id "script". */
  script: z.string().max(MAX_SCRIPT_LENGTH).optional(),
  /** Start trading straight away instead of creating the bot paused. */
  start: z.boolean().optional(),
});

export const GET = withUser(async (user) => NextResponse.json(await forUser(user.id).bots.all({ order: { field: "created_at" } })));

export const POST = withUser(async (user, request) => {
  const blocked = needsVerifiedEmail(user);
  if (blocked) return blocked;
  const parsed = botInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const input = parsed.data;
  const store = forUser(user.id);

  const broker = await store.brokers.get(input.broker_account_id);
  if (!broker) return jsonError(400, "UNKNOWN_BROKER");

  let strategy: Bot["strategy"] = null;
  if (input.source === "builtin" && input.strategy_id === SCRIPT_STRATEGY_ID) {
    if (!input.script?.trim()) return jsonError(400, "SCRIPT_REQUIRED");
    const params = { atr_mult: 2, rr: 2, ...input.strategy_params };
    try {
      const check = await checkScript(input.script, params);
      strategy = { id: SCRIPT_STRATEGY_ID, params: { ...check.inputs, ...params }, code: input.script };
    } catch (error) {
      if (error instanceof ScriptError) return jsonError(400, "SCRIPT_ERROR", error.message);
      throw error;
    }
  } else if (input.source === "builtin") {
    const def = getStrategy(input.strategy_id ?? "");
    if (!def) return jsonError(400, "UNKNOWN_STRATEGY");
    strategy = { id: def.id, params: { ...defaultParams(def), ...input.strategy_params } };
  }

  const startNow = Boolean(input.start) && !(await getSettings(user.id)).kill_switch;
  const existing = await store.bots.all();
  const bot: Bot = {
    id: newId(),
    user_id: user.id,
    name: input.name,
    source: input.source,
    broker_account_id: broker.id,
    symbol: input.symbol,
    data_symbol: input.data_symbol || guessDataSymbol(input.symbol),
    price_source: broker.kind === "mt5" ? input.price_source : "deriv",
    timeframe: input.timeframe,
    strategy,
    status: startNow ? "running" : "paused",
    paused_reason: startNow ? null : input.start ? "Kill switch is on — start the bot after releasing it" : "New bot — press Start when ready",
    risk_percent: input.risk_percent,
    deriv_multiplier: input.deriv_multiplier,
    magic: nextMagic(existing),
    webhook_passphrase: randomToken(18),
    last_bar_epoch: null,
    last_signal_at: null,
    created_at: nowIso(),
  };
  await store.bots.insert(bot);
  await log("info", `Bot "${bot.name}" created on ${broker.label}${broker.is_demo ? " (demo)" : ""}${startNow ? " and started" : ""}`, {
    user_id: user.id,
    bot_id: bot.id,
  });
  return NextResponse.json(bot, { status: 201 });
});

function nextMagic(existing: Bot[]): number {
  const used = new Set(existing.map((b) => b.magic));
  let magic = 770001;
  while (used.has(magic)) magic++;
  return magic;
}
