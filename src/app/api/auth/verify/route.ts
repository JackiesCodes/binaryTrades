import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeToken, updateUser } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";
import { nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(10).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_LINK");
  const user = await consumeToken(parsed.data.token, "verify_email");
  if (!user) return jsonError(400, "INVALID_LINK");
  if (!user.email_verified_at) await updateUser(user.id, { email_verified_at: nowIso() });
  return NextResponse.json({ ok: true });
}
