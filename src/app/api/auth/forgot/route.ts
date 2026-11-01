import { NextResponse } from "next/server";
import { z } from "zod";

import { appUrl, emailEnabled, resetEmail, sendEmail } from "@/lib/auth/email";
import { clientIp, getUserByEmail, issueToken, rateLimited } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().email().max(200) });

/** Always answers the same way, so it can't be used to find out who has an account. */
export async function POST(request: Request) {
  if (!emailEnabled()) return jsonError(503, "RESET_UNAVAILABLE");
  if (rateLimited(`forgot:${clientIp(request)}`, 5, 15 * 60_000)) return jsonError(429, "TOO_MANY_ATTEMPTS");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_EMAIL");
  const user = await getUserByEmail(parsed.data.email);
  if (user && !user.disabled && !rateLimited(`forgot:${user.id}`, 3, 60 * 60_000)) {
    try {
      const token = await issueToken(user.id, "reset_password");
      const mail = resetEmail(`${appUrl(request)}/reset-password?token=${token}`);
      await sendEmail(user.email!, mail.subject, mail.html);
    } catch (error) {
      console.error("[binaryTrades] reset email failed", error);
    }
  }
  return NextResponse.json({ ok: true });
}
