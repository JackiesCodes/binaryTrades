import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { tickUser } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The open dashboard calls this every minute: it runs the signed-in user's share of the engine.
// (The cron endpoint runs everyone's.)
const inFlight = new Map<string, Promise<Record<string, string>>>();

export const POST = withUser(async (user) => {
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
