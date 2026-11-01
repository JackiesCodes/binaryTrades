import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/cookie";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkEnvPassword } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH, bumpSessions, publicUser, withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { log, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ current_password: z.string().min(1).max(200), new_password: z.string().max(200) });

export const POST = withUser(async (user, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { current_password, new_password } = parsed.data;
  const ok = user.password_hash ? await verifyPassword(current_password, user.password_hash) : await checkEnvPassword(current_password);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return jsonError(401, "WRONG_CURRENT_PASSWORD");
  }
  if (new_password.length < MIN_PASSWORD_LENGTH) return jsonError(400, "PASSWORD_TOO_SHORT");
  if (new_password === current_password) return jsonError(400, "PASSWORD_UNCHANGED");
  const updated = await bumpSessions(user, { password_hash: await hashPassword(new_password), password_changed_at: nowIso() });
  await log("warn", "Password changed — other devices were signed out", { user_id: user.id });
  return setSessionCookie(NextResponse.json(publicUser(updated)), updated);
});
