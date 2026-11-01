import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/auth/cookie";
import { appUrl, emailEnabled, sendEmail, verificationEmail } from "@/lib/auth/email";
import { MIN_PASSWORD_LENGTH, SignupError, clientIp, createUser, issueToken, rateLimited } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { log } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  display_name: z.string().trim().max(60).optional(),
  accept_terms: z.literal(true),
});

export async function POST(request: Request) {
  if (process.env.SIGNUPS_DISABLED === "1") return jsonError(403, "SIGNUPS_CLOSED");
  if (rateLimited(`signup:${clientIp(request)}`, 5, 60 * 60_000)) return jsonError(429, "TOO_MANY_ATTEMPTS");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.accept_terms) return jsonError(400, "ACCEPT_TERMS");
    if (fields.password) return jsonError(400, "PASSWORD_TOO_SHORT");
    if (fields.email) return jsonError(400, "INVALID_EMAIL");
    return zodError(parsed.error);
  }
  let user;
  try {
    user = await createUser(parsed.data);
  } catch (error) {
    if (error instanceof SignupError) return jsonError(error.message === "EMAIL_TAKEN" ? 409 : 400, error.message);
    throw error;
  }
  await log("info", "Welcome to binaryTrades — connect a demo account to get started", { user_id: user.id });
  if (emailEnabled()) {
    try {
      const token = await issueToken(user.id, "verify_email");
      const mail = verificationEmail(`${appUrl(request)}/verify-email?token=${token}`);
      await sendEmail(user.email!, mail.subject, mail.html);
    } catch (error) {
      console.error("[binaryTrades] verification email failed", error);
    }
  }
  return setSessionCookie(NextResponse.json({ ok: true, verify_sent: emailEnabled() }, { status: 201 }), user);
}
