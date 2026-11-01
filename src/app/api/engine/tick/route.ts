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
  return NextResponse.json({ at: new Date().toISOString(), bots: await run });
});
