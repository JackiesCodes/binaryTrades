import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { keepServerFired, sanitizeAlerts } from "@/lib/markets/alerts";
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
