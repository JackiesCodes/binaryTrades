import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/cookie";
import { authenticate, clientIp, rateLimited } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().max(200).optional().default(""),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "WRONG_PASSWORD");
  const { email, password } = parsed.data;
  if (rateLimited(`login:${clientIp(request)}`, 20, 15 * 60_000) || (email && rateLimited(`login:${email.toLowerCase()}`, 10, 15 * 60_000))) {
    return jsonError(429, "TOO_MANY_ATTEMPTS");
  }
  const user = await authenticate(email || null, password);
  if (!user) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return jsonError(401, email ? "WRONG_EMAIL_OR_PASSWORD" : "WRONG_PASSWORD");
  }
  return setSessionCookie(NextResponse.json({ ok: true, needs_email: !user.email }), user);
}
