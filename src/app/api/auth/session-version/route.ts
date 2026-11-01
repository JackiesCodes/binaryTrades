import { NextResponse } from "next/server";

import { getProfile } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

// Used by the middleware on self-hosted (file-backed) installs. Reveals only a counter.
export async function GET() {
  return NextResponse.json({ version: (await getProfile()).session_version });
}
