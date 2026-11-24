import { NextResponse } from "next/server";

import { getStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/** Running bots are checked every minute and their check saved at least every 5 minutes. */
const ENGINE_STALE_MS = 10 * 60_000;

/**
 * Public status for an uptime monitor (UptimeRobot, Better Stack…): 200 when the database answers and
 * the every-minute engine is checking running bots, 503 otherwise. Says nothing about any account.
 */
export async function GET() {
  const at = new Date().toISOString();
  let database: "ok" | "down" = "ok";
  let engine: "ok" | "stale" | "idle" = "idle";
  try {
    // Bots started in the last minute haven't been checked yet: only checked ones say anything.
    const checks = (await getStore().bots.all({ eq: { status: "running" }, limit: 500 }))
      .map((b) => (b.last_check?.at ? Date.parse(b.last_check.at) : NaN))
      .filter(Number.isFinite);
    if (checks.length) engine = Date.now() - Math.max(...checks) <= ENGINE_STALE_MS ? "ok" : "stale";
  } catch {
    database = "down";
  }
  const ok = database === "ok" && engine !== "stale";
  return NextResponse.json({ ok, database, engine, at }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
