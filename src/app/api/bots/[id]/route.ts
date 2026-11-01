import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { getStrategy } from "@/lib/strategies";
import { MAX_SCRIPT_LENGTH, SCRIPT_STRATEGY_ID, ScriptError, checkScript } from "@/lib/strategies/script";
import { activeTrades, closeTrade } from "@/lib/trading/engine";
import { forUser, getSettings, log } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["running", "paused"]).optional(),
  name: z.string().trim().min(1).max(60).optional(),
  broker_account_id: z.string().min(1).optional(),
  risk_percent: z.coerce.number().min(0.1).max(5).optional(),
  deriv_multiplier: z.coerce.number().int().min(1).max(5000).optional(),
  timeframe: z.coerce.number().int().positive().optional(),
  price_source: z.enum(["deriv", "broker"]).optional(),
  strategy_params: z.record(z.coerce.number()).optional(),
  /** New source code for a script bot. */
  script: z.string().min(1).max(MAX_SCRIPT_LENGTH).optional(),
});

type Ctx = { params: { id: string } };

export const PATCH = withUser<Ctx>(async (user, request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { strategy_params, script, ...rest } = parsed.data;

  const patch: Partial<Bot> = { ...rest };
  if (bot.strategy?.id === SCRIPT_STRATEGY_ID && (script !== undefined || strategy_params)) {
    const code = script ?? bot.strategy.code ?? "";
    const params = { ...bot.strategy.params, ...strategy_params };
    try {
      const check = await checkScript(code, params);
      // Keep only inputs the script still declares, plus the stop / target settings.
      const kept = Object.fromEntries(Object.entries(params).filter(([k]) => k in check.inputs || k === "atr_mult" || k === "rr"));
      patch.strategy = { id: SCRIPT_STRATEGY_ID, code, params: { ...check.inputs, ...kept } };
    } catch (error) {
      if (error instanceof ScriptError) return jsonError(400, "SCRIPT_ERROR", error.message);
      throw error;
    }
  } else if (script !== undefined) {
    return jsonError(400, "NOT_A_SCRIPT_BOT");
  } else if (strategy_params && bot.strategy && getStrategy(bot.strategy.id)) {
    patch.strategy = { ...bot.strategy, params: { ...bot.strategy.params, ...strategy_params } };
  }

  if (patch.broker_account_id !== undefined && patch.broker_account_id !== bot.broker_account_id) {
    if (!patch.broker_account_id || !(await store.brokers.get(patch.broker_account_id))) return jsonError(400, "UNKNOWN_BROKER");
    if ((await activeTrades(user.id, { bot_id: bot.id })).length) return jsonError(409, "CLOSE_TRADES_BEFORE_SWITCHING_ACCOUNT");
  }

  if (patch.status === "running") {
    if ((await getSettings(user.id)).kill_switch) return jsonError(409, "KILL_SWITCH_ON");
    if (!(patch.broker_account_id ?? bot.broker_account_id)) return jsonError(400, "BOT_NEEDS_BROKER");
    patch.paused_reason = null;
  } else if (patch.status === "paused") {
    patch.paused_reason = "Paused by you";
  }

  const updated = await store.bots.update(bot.id, patch);
  if (script !== undefined) await log("info", `Bot "${bot.name}" script updated`, { user_id: user.id, bot_id: bot.id });
  if (patch.status && patch.status !== bot.status) {
    await log("info", `Bot "${bot.name}" ${patch.status === "running" ? "started" : "paused"}`, { user_id: user.id, bot_id: bot.id });
  }
  return NextResponse.json(updated);
});

export const DELETE = withUser<Ctx>(async (user, _request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");
  for (const trade of await activeTrades(user.id, { bot_id: bot.id })) await closeTrade(trade, "Bot deleted");
  await store.bots.remove(bot.id);
  await log("info", `Bot "${bot.name}" deleted`, { user_id: user.id });
  return NextResponse.json({ ok: true });
});
