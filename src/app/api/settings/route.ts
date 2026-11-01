import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { zodError } from "@/lib/http";
import { getSettings, log, updateSettings } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  daily_loss_limit: z.coerce.number().min(0).optional(),
  max_drawdown_percent: z.coerce.number().min(0).max(100).optional(),
  max_open_trades: z.coerce.number().int().min(1).max(100).optional(),
  max_trades_per_bot: z.coerce.number().int().min(1).max(10).optional(),
  default_risk_percent: z.coerce.number().min(0.1).max(5).optional(),
});

export const GET = withUser(async (user) => NextResponse.json(await getSettings(user.id)));

export const PATCH = withUser(async (user, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const settings = await updateSettings(user.id, parsed.data);
  await log("info", "Risk Guard settings updated", { user_id: user.id, context: parsed.data });
  return NextResponse.json(settings);
});
