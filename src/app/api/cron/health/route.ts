import { NextResponse } from "next/server";
import postgres from "postgres";

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

  // Direct database view (bypasses the Supabase REST API): row counts and
  // Postgres's own insert/delete counters per table.
  const dbUrl = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;
  if (dbUrl) {
    const sql = postgres(dbUrl, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
    try {
      report.brokers_in_database = await sql`
        select label, kind, status, is_demo, (app_id is not null) as has_app_id, created_at from brokers order by created_at`;
      report.database = await sql`
        select relname as table, n_live_tup as rows, n_tup_ins as inserted, n_tup_del as deleted
        from pg_stat_user_tables where schemaname = 'public' order by relname`;
      // Supabase project ref of each connection, to confirm both point at the same database.
      const u = new URL(dbUrl);
      report.database_project = u.username.split(".")[1] ?? u.hostname.split(".")[1] ?? null;
      report.rest_host = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
    } catch (error) {
      report.database_error = (error as Error).message;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
  return NextResponse.json(report);
}
