import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";
import { forUser } from "@/lib/trading/store";
import type { ClosedTrade } from "@/lib/trading/performance";

export const dynamic = "force-dynamic";

/** Enough history for the figures; the dashboard state only carries the latest 200 trades of all bots. */
const MAX_TRADES = 2000;

/** The bot's closed trades, newest first, with just what the performance figures need. */
export const GET = withUser<{ params: { id: string } }>(async (user, _request, { params }) => {
  const store = forUser(user.id);
  const bot = await store.bots.get(params.id);
  if (!bot) return jsonError(404, "NOT_FOUND");
  const rows = await store.trades.all({
    eq: { bot_id: bot.id, status: "closed" },
    order: { field: "closed_at", ascending: false },
    limit: MAX_TRADES,
  });
  const trades: ClosedTrade[] = rows
    .filter((t) => t.closed_at)
    .map((t) => ({ side: t.side, pnl: t.pnl, risk_amount: t.risk_amount, opened_at: t.opened_at, closed_at: t.closed_at! }));
  return NextResponse.json({ trades, capped: rows.length >= MAX_TRADES }, { headers: { "cache-control": "private, no-store" } });
});
