import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { runEngineTick } from "@/lib/trading/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * For an external scheduler (cron-job.org, Vercel Cron, a systemd timer…) so
 * bots keep running with the dashboard closed. Call once a minute with
 * `Authorization: Bearer $CRON_SECRET` (or `?key=$CRON_SECRET`).
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (!secret || provided !== secret) return jsonError(401, "INVALID_CRON_SECRET");
  const report = await runEngineTick();
  // One line per tick in the server log: each running bot and the engine's verdict on it.
  const entries = Object.entries(report.bots);
  const alerts = report.alerts ? ` · price alerts: ${report.alerts.waiting} waiting, ${report.alerts.fired} fired` : "";
  console.info(`[engine] ${report.users} users, ${entries.length} bots${alerts} — ${entries.map(([k, v]) => `${k}: ${v}`).join(" | ").slice(0, 3000)}`);
  return NextResponse.json(report);
}

export const GET = handle;
export const POST = handle;
