import "server-only";

import type { Sql } from "postgres";

/**
 * Runs the engine every minute from inside the database, so bots trade 24/7
 * without an outside scheduler: Supabase's pg_cron fires a job that calls
 * /api/cron/tick through pg_net. The job is (re)registered on start-up from
 * CRON_SECRET and APP_URL, so the secret never lives in the code.
 *
 * Only the production deployment registers it (VERCEL_ENV=production, or
 * ENGINE_SCHEDULER=1 elsewhere). Set ENGINE_SCHEDULER=0 to turn it off.
 */
export const ENGINE_JOB = "binarytrades-engine-tick";

export function schedulerWanted(): boolean {
  if (process.env.ENGINE_SCHEDULER === "0") return false;
  if (!process.env.CRON_SECRET) return false;
  return process.env.ENGINE_SCHEDULER === "1" || process.env.VERCEL_ENV === "production";
}

export function tickUrl(): string {
  const base = (process.env.APP_URL ?? "https://binarytrades.trading").replace(/\/$/, "");
  return `${base}/api/cron/tick?key=${encodeURIComponent(process.env.CRON_SECRET ?? "")}`;
}

function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function ensureEngineSchedule(sql: Sql): Promise<"registered" | "unchanged" | "skipped"> {
  if (!schedulerWanted()) return "skipped";
  await sql.unsafe("create extension if not exists pg_net with schema extensions");
  await sql.unsafe("create extension if not exists pg_cron");
  const command = `select net.http_get(url := ${literal(tickUrl())}, timeout_milliseconds := 55000)`;
  const [existing] = await sql<{ command: string; schedule: string; active: boolean }[]>`
    select command, schedule, active from cron.job where jobname = ${ENGINE_JOB}`;
  if (existing && existing.command === command && existing.schedule === "* * * * *" && existing.active) return "unchanged";
  if (existing) await sql`select cron.unschedule(${ENGINE_JOB})`;
  await sql`select cron.schedule(${ENGINE_JOB}, '* * * * *', ${command})`;
  return "registered";
}

/** For the health check: the job, its last runs and the last HTTP answers (no secrets). */
export async function engineScheduleStatus(sql: Sql) {
  const [job] = await sql<{ jobid: number; schedule: string; active: boolean }[]>`
    select jobid, schedule, active from cron.job where jobname = ${ENGINE_JOB}`;
  if (!job) return { registered: false };
  const runs = await sql`
    select status, start_time, end_time, return_message from cron.job_run_details
    where jobid = ${job.jobid} order by start_time desc limit 5`;
  const responses = await sql`
    select status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5`.catch(() => []);
  return { registered: true, schedule: job.schedule, active: job.active, last_runs: runs, last_responses: responses };
}
