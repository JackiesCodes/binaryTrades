import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { tickUser } from "@/lib/trading/engine";
import { forUser } from "@/lib/trading/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The open dashboard calls this every minute: without a scheduler it runs the signed-in user's
// share of the engine. (The cron endpoint runs everyone's.)
const inFlight = new Map<string, Promise<Record<string, string>>>();

export const POST = withUser(async (user) => {
  // With the every-minute scheduler set up (CRON_SECRET), it alone runs the bots. An open dashboard
  // running them too could act on the same new candle as the scheduler on another server, a few
  // seconds apart, and open the trade twice. Without a scheduler (e.g. on your own PC), the open
  // dashboard is what runs them.
  if (process.env.CRON_SECRET) {
    // "Engine on · 1m ago" then reports when the scheduler last checked this user's running bots.
    const running = await forUser(user.id).bots.all({ eq: { status: "running" } });
    const checks = running.map((b) => b.last_check?.at).filter((x): x is string => Boolean(x)).sort();
    return NextResponse.json({ at: checks.at(-1) ?? new Date().toISOString(), bots: {}, scheduler: true });
  }
  let run = inFlight.get(user.id);
  if (!run) {
    run = tickUser(user.id).finally(() => inFlight.delete(user.id));
    inFlight.set(user.id, run);
  }
  const bots = await run;
  // Candle-close verdicts reached from an open dashboard also go to the server log (the cron logs its own).
  const decided = Object.entries(bots).filter(([, v]) => v !== "waiting for next bar");
  if (decided.length) console.info(`[engine:dashboard] ${decided.map(([k, v]) => `${k}: ${v}`).join(" | ").slice(0, 2000)}`);
  return NextResponse.json({ at: new Date().toISOString(), bots });
});
