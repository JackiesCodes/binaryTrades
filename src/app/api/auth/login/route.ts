import { NextResponse } from "next/server";

import { checkLoginPassword, getProfile } from "@/lib/auth/account";
import { setSessionCookie } from "@/lib/auth/cookie";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!process.env.APP_PASSWORD) return jsonError(503, "APP_PASSWORD_NOT_SET");
  const profile = await getProfile();
  if (!password || !(await checkLoginPassword(password, profile))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return jsonError(401, "WRONG_PASSWORD");
  }
  return setSessionCookie(NextResponse.json({ ok: true }), profile.session_version);
}
