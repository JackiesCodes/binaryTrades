import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { withUser } from "@/lib/auth/users";
import { getDashboardState } from "@/lib/trading/state";

export const dynamic = "force-dynamic";

/**
 * The dashboard's data. The dashboard asks every few seconds and sends the fingerprint (ETag) of
 * what it already has; when nothing changed the answer is an empty 304 instead of the whole state.
 */
export const GET = withUser(async (user, request) => {
  const state = await getDashboardState(user);
  // The fingerprint leaves out generated_at, which differs on every call.
  const etag = `"${createHash("sha1")
    .update(JSON.stringify({ ...state, meta: { ...state.meta, generated_at: null } }))
    .digest("base64url")}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return NextResponse.json(state, { headers });
});
