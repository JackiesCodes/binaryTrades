import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { derivCandlesBetween } from "@/lib/brokers/deriv";
import { jsonError, zodError } from "@/lib/http";

export const dynamic = "force-dynamic";

const TIMEFRAMES = [60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];

const schema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9_]{2,30}$/),
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  /** Seconds per candle; omitted = chosen so the window shows roughly 60–150 candles. */
  tf: z.coerce.number().int().positive().optional(),
});

/** Candles for a chart of a market between two times (Unix seconds). */
export const GET = withUser(async (_user, request) => {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return zodError(parsed.error);
  const { symbol, from, to } = parsed.data;
  if (to <= from) return jsonError(400, "INVALID_RANGE");
  const span = to - from;
  const tf = parsed.data.tf && TIMEFRAMES.includes(parsed.data.tf) ? parsed.data.tf : (TIMEFRAMES.find((t) => span / t <= 150) ?? 86400);
  try {
    const candles = await derivCandlesBetween(symbol, tf, from, Math.min(to, Math.floor(Date.now() / 1000)));
    return NextResponse.json({ symbol, timeframe: tf, candles });
  } catch (error) {
    return jsonError(502, "MARKET_DATA_UNAVAILABLE", (error as Error).message);
  }
});
