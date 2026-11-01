import { NextResponse } from "next/server";
import { z } from "zod";

import { checkLoginPassword, getProfile, publicProfile } from "@/lib/auth/account";
import { setSessionCookie } from "@/lib/auth/cookie";
import { hashPassword } from "@/lib/auth/password";
import { jsonError, zodError } from "@/lib/http";
import { getStore, log, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().max(200),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { current_password, new_password } = parsed.data;

  const profile = await getProfile();
  if (!(await checkLoginPassword(current_password, profile))) {
    await new Promise((r) => setTimeout(r, 600));
    return jsonError(401, "WRONG_CURRENT_PASSWORD");
  }
  if (new_password.length < 10) return jsonError(400, "PASSWORD_TOO_SHORT");
  if (new_password === current_password) return jsonError(400, "PASSWORD_UNCHANGED");

  // New hash + new session version: every other device is signed out; this one gets a fresh cookie.
  const version = profile.session_version + 1;
  const now = nowIso();
  const updated = await getStore().profile.update("owner", {
    password_hash: await hashPassword(new_password),
    password_changed_at: now,
    session_version: version,
    updated_at: now,
  });
  await log("warn", "Password changed — other devices were signed out");
  return setSessionCookie(NextResponse.json(publicProfile(updated!)), version);
}
