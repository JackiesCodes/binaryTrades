import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/cookie";
import { hashPassword } from "@/lib/auth/password";
import { MIN_PASSWORD_LENGTH, bumpSessions, consumeToken } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";
import { log, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(10).max(200), password: z.string().max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_LINK");
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) return jsonError(400, "PASSWORD_TOO_SHORT");
  const user = await consumeToken(parsed.data.token, "reset_password");
  if (!user) return jsonError(400, "INVALID_LINK");
  const now = nowIso();
  // Resetting proves control of the email, and signs out every other session.
  const updated = await bumpSessions(user, {
    password_hash: await hashPassword(parsed.data.password),
    password_changed_at: now,
    email_verified_at: user.email_verified_at ?? now,
  });
  await log("warn", "Password reset by email — other devices were signed out", { user_id: user.id });
  return setSessionCookie(NextResponse.json({ ok: true }), updated);
}
