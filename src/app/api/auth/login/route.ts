import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/cookie";
import { authenticate, clientIp, getUserByEmail, rateLimited } from "@/lib/auth/users";
import { getStore, log } from "@/lib/trading/store";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().max(200).optional().default(""),
  password: z.string().min(1).max(200),
});

/** Failed sign-ins on one account within this window lock it until the window has passed. */
const LOCK_AFTER_FAILURES = 10;
const LOCK_WINDOW_MS = 15 * 60_000;
const FAILED = "Failed sign-in attempt";

/**
 * Failed attempts on an account in the last 15 minutes, counted in the database: the in-memory
 * limits above only see one server, and the site runs on many.
 */
async function recentFailures(userId: string): Promise<number> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();
  const rows = await getStore()
    .logs.all({ eq: { user_id: userId, message: FAILED }, since: { field: "created_at", value: since }, limit: LOCK_AFTER_FAILURES })
    .catch(() => []);
  return rows.length;
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "WRONG_PASSWORD");
  const { email, password } = parsed.data;
  if (rateLimited(`login:${clientIp(request)}`, 20, 15 * 60_000) || (email && rateLimited(`login:${email.toLowerCase()}`, 10, 15 * 60_000))) {
    return jsonError(429, "TOO_MANY_ATTEMPTS");
  }
  const account = email ? await getUserByEmail(email) : null;
  if (account && (await recentFailures(account.id)) >= LOCK_AFTER_FAILURES) return jsonError(429, "TOO_MANY_ATTEMPTS");
  const user = await authenticate(email || null, password);
  if (!user) {
    // The account's owner sees attempts in Alerts & Logs (with the address they came from).
    if (account) await log("warn", FAILED, { user_id: account.id, context: { ip: clientIp(request) } });
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return jsonError(401, email ? "WRONG_EMAIL_OR_PASSWORD" : "WRONG_PASSWORD");
  }
  return setSessionCookie(NextResponse.json({ ok: true, needs_email: !user.email }), user);
}
