import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { keepServerFired, sameTrade, sanitizeAlerts } from "@/lib/markets/alerts";
import { MARKETS_KEYS, MAX_STATE_SIZE, sanitizePart, type MarketsDoc } from "@/lib/markets/state";
import { forUser, nowIso } from "@/lib/trading/store";
import type { MarketsState } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

/** Saved parts only: a part the user never saved comes back as null (the browser then keeps its own). */
function toResponse(row: MarketsState | null) {
  return {
    watchlist: row?.watchlist ?? null,
    indicators: row?.indicators ?? null,
    drawings: row?.drawings ?? null,
    alerts: row?.alerts ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

/** The signed-in user's Markets page: watchlist, indicators, drawings and price alerts. */
export const GET = withUser(async (user) => NextResponse.json(toResponse(await forUser(user.id).markets_state.get(user.id))));

const putSchema = z
  .object({
    watchlist: z.array(z.unknown()).max(200).optional(),
    indicators: z.array(z.unknown()).max(50).optional(),
    drawings: z.record(z.unknown()).optional(),
    alerts: z.array(z.unknown()).max(500).optional(),
  })
  .strict();

/** Saves the parts sent (each is repaired and capped); parts not sent are left as they are. */
export const PUT = withUser(async (user, request) => {
  const text = await request.text();
  if (text.length > MAX_STATE_SIZE) return jsonError(413, "TOO_LARGE");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "INVALID_REQUEST");
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return zodError(parsed.error);

  const patch: Partial<MarketsDoc> = {};
  for (const key of MARKETS_KEYS) {
    if (parsed.data[key] !== undefined) (patch as Record<string, unknown>)[key] = sanitizePart(key, parsed.data[key]);
  }
  if (!Object.keys(patch).length) return jsonError(400, "NOTHING_TO_SAVE");

  const store = forUser(user.id).markets_state;
  const existing = await store.get(user.id);
  // Alerts the server fired since the page last loaded stay fired.
  if (patch.alerts && existing?.alerts) patch.alerts = keepServerFired(patch.alerts, sanitizeAlerts(existing.alerts));

  // Alert trades: only through the user's own bots on demo accounts, trading the alert's market.
  // Checked when an alert's trade is new or changed (a saved alert isn't re-judged on every save).
  if (patch.alerts) {
    const stored = new Map(sanitizeAlerts(existing?.alerts ?? []).map((a) => [a.id, a]));
    const mine = forUser(user.id);
    for (const a of patch.alerts) {
      if (!a.trade || a.triggered_at || sameTrade(a.trade, stored.get(a.id)?.trade)) continue;
      const bot = await mine.bots.get(a.trade.bot_id);
      if (!bot) return jsonError(400, "ALERT_TRADE_BOT", "That bot wasn't found. Pick another bot for the alert.");
      const broker = bot.broker_account_id ? await mine.brokers.get(bot.broker_account_id) : null;
      if (!broker?.is_demo) return jsonError(400, "ALERT_TRADE_DEMO_ONLY", "Alert trades work with bots on demo accounts only, for now.");
      if (a.symbol !== `deriv:${bot.data_symbol}`) return jsonError(400, "ALERT_TRADE_MARKET", `${bot.name} trades a different market from this alert.`);
    }
  }
  const row = existing
    ? await store.update(user.id, { ...(patch as Partial<MarketsState>), updated_at: nowIso() })
    : await store.insert({
        id: user.id,
        user_id: user.id,
        watchlist: null,
        indicators: null,
        drawings: null,
        alerts: null,
        ...(patch as Partial<MarketsState>),
        updated_at: nowIso(),
      });
  return NextResponse.json(toResponse(row));
});
