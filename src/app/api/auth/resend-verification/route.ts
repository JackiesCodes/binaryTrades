import { NextResponse } from "next/server";

import { appUrl, emailEnabled, sendEmail, verificationEmail } from "@/lib/auth/email";
import { issueToken, rateLimited, withUser } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = withUser(async (user, request) => {
  if (!emailEnabled()) return jsonError(503, "EMAIL_UNAVAILABLE");
  if (!user.email) return jsonError(400, "ADD_EMAIL_FIRST");
  if (user.email_verified_at) return NextResponse.json({ ok: true, already: true });
  if (rateLimited(`verify:${user.id}`, 3, 60 * 60_000)) return jsonError(429, "TOO_MANY_ATTEMPTS");
  const token = await issueToken(user.id, "verify_email");
  const mail = verificationEmail(`${appUrl(request)}/verify-email?token=${token}`);
  try {
    await sendEmail(user.email, mail.subject, mail.html);
  } catch (error) {
    return jsonError(502, "EMAIL_FAILED", (error as Error).message);
  }
  return NextResponse.json({ ok: true });
});
