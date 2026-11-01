import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { getStore } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/**
 * Health check for diagnosing a live deployment without a browser session:
 * connected accounts (no tokens or keys), bot counts and the latest warnings.
 * Protected by CRON_SECRET like /api/cron/tick.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (!secret || provided !== secret) return jsonError(401, "INVALID_CRON_SECRET");

  const store = getStore();
  const report: Record<string, unknown> = { backend: store.backend, at: new Date().toISOString() };
  try {
    const brokers = await store.brokers.all({ order: { field: "created_at" } });
    report.brokers = brokers.map((b) => ({
      label: b.label,
      kind: b.kind,
      status: b.status,
      is_demo: b.is_demo,
      has_app_id: Boolean(b.app_id),
      error: b.error,
      last_sync_at: b.last_sync_at,
      created_at: b.created_at,
    }));
    report.bots = (await store.bots.all()).length;
    report.recent_logs = (await store.logs.all({ order: { field: "created_at", ascending: false }, limit: 25 })).map((l) => ({
      at: l.created_at,
      level: l.level,
      message: l.message,
    }));
  } catch (error) {
    report.storage_error = (error as Error).message;
  }
  return NextResponse.json(report);
}
