import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { endChallenge } from "@/lib/trading/engine";
import { CHALLENGE_MAX_RISK } from "@/lib/trading/risk";
import { forUser, getSettings, log, nowIso } from "@/lib/trading/store";
import type { Challenge } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  risk_percent: z.coerce.number().min(5).max(CHALLENGE_MAX_RISK),
  target_multiple: z.coerce.number().min(1.1).max(10).default(2),
  hours: z.coerce.number().min(1).max(72).default(24),
});

type Ctx = { params: { id: string } };

/** Start a demo-only challenge: high risk per trade until the account hits the target, loses 90% or time runs out. */
export const POST = withUser<Ctx>(async (user, request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);

  if (bot.challenge && !bot.challenge.ended_at) return jsonError(409, "CHALLENGE_RUNNING");
  const broker = bot.broker_account_id ? await store.brokers.get(bot.broker_account_id) : null;
  if (!broker) return jsonError(400, "BOT_NEEDS_BROKER");
  // The one rule that matters most: never on real money.
  if (!broker.is_demo) return jsonError(403, "CHALLENGE_DEMO_ONLY");
  if (broker.status !== "connected") return jsonError(409, "BROKER_NOT_CONNECTED");
  if (!(broker.equity > 0)) return jsonError(409, "NO_EQUITY");
  if ((await getSettings(user.id)).kill_switch) return jsonError(409, "KILL_SWITCH_ON");

  const challenge: Challenge = {
    ...parsed.data,
    started_at: nowIso(),
    start_equity: broker.equity,
    ended_at: null,
    result: null,
    end_equity: null,
  };
  const updated = await store.bots.update(bot.id, { challenge, status: "running", paused_reason: null });
  await log(
    "warn",
    `${bot.name}: demo challenge started — ${challenge.risk_percent}% risk per trade, target ×${challenge.target_multiple} of ${broker.equity.toFixed(2)} within ${challenge.hours}h`,
    { user_id: user.id, bot_id: bot.id },
  );
  return NextResponse.json(updated);
});

/** Stop a running challenge: closes the bot's trades and pauses it. */
export const DELETE = withUser<Ctx>(async (user, _request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "BOT_NOT_FOUND");
  if (!bot.challenge || bot.challenge.ended_at) return jsonError(409, "NO_CHALLENGE_RUNNING");
  return NextResponse.json(await endChallenge(bot, "stopped", "by you"));
});
