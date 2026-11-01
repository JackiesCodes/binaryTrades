import { NextResponse } from "next/server";

import { getProfile } from "@/lib/auth/account";
import { setSessionCookie } from "@/lib/auth/cookie";
import { getStore, log, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

/** Signs out every other device by bumping the session version; this browser stays signed in. */
export async function DELETE() {
  const profile = await getProfile();
  const version = profile.session_version + 1;
  await getStore().profile.update("owner", { session_version: version, updated_at: nowIso() });
  await log("warn", "Signed out all other devices");
  return setSessionCookie(NextResponse.json({ ok: true }), version);
}
