import { NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/auth/cookie";
import { bumpSessions, withUser } from "@/lib/auth/users";
import { log } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/** Signs out every other device; this browser gets a fresh cookie and stays signed in. */
export const DELETE = withUser(async (user) => {
  const updated = await bumpSessions(user);
  await log("warn", "Signed out all other devices", { user_id: user.id });
  return setSessionCookie(NextResponse.json({ ok: true }), updated);
});
