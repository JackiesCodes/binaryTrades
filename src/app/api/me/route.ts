import { NextResponse } from "next/server";
import { z } from "zod";

import { appUrl, emailEnabled, sendEmail, verificationEmail } from "@/lib/auth/email";
import { verifyPassword } from "@/lib/auth/password";
import { checkEnvPassword } from "@/lib/auth/session";
import { getUserByEmail, issueToken, normalizeEmail, publicUser, updateUser, withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { activeTrades, closeTrade } from "@/lib/trading/engine";
import { forUser, getStore, log } from "@/lib/trading/store";
import type { User } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  display_name: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().email().max(200).optional(),
});

export const GET = withUser(async (user) => NextResponse.json(publicUser(user)));

export const PATCH = withUser(async (user, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return parsed.error.flatten().fieldErrors.email ? jsonError(400, "INVALID_EMAIL") : zodError(parsed.error);
  const patch: Partial<User> = {};
  if (parsed.data.display_name !== undefined) patch.display_name = parsed.data.display_name || null;
  let sendVerification = false;
  if (parsed.data.email !== undefined) {
    const email = normalizeEmail(parsed.data.email);
    if (email !== user.email) {
      const other = await getUserByEmail(email);
      if (other && other.id !== user.id) return jsonError(409, "EMAIL_TAKEN");
      patch.email = email;
      patch.email_verified_at = emailEnabled() ? null : new Date().toISOString();
      sendVerification = emailEnabled();
    }
  }
  const updated = await updateUser(user.id, patch);
  if (sendVerification) {
    try {
      const token = await issueToken(user.id, "verify_email");
      const mail = verificationEmail(`${appUrl(request)}/verify-email?token=${token}`);
      await sendEmail(updated.email!, mail.subject, mail.html);
    } catch (error) {
      console.error("[binaryTrades] verification email failed", error);
    }
  }
  return NextResponse.json(publicUser(updated));
});

const deleteSchema = z.object({ password: z.string().min(1).max(200) });

/** Permanently deletes the account and everything in it. Open positions are closed first where possible. */
export const DELETE = withUser(async (user, request) => {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "WRONG_CURRENT_PASSWORD");
  const ok = user.password_hash ? await verifyPassword(parsed.data.password, user.password_hash) : await checkEnvPassword(parsed.data.password);
  if (!ok) return jsonError(401, "WRONG_CURRENT_PASSWORD");
  if (user.id === "owner" || user.role === "admin") {
    const admins = (await getStore().users.all({ eq: { role: "admin" } })).filter((u) => !u.disabled);
    if (admins.length <= 1) return jsonError(409, "LAST_ADMIN");
  }
  for (const trade of await activeTrades(user.id)) {
    try {
      if (!trade.external) await closeTrade(trade, "Account deleted");
    } catch {
      // Positions the broker refuses to close stay at the broker; the user is told to check there.
    }
  }
  const store = getStore();
  const mine = forUser(user.id);
  for (const b of await mine.bots.all()) await mine.bots.update(b.id, { status: "paused", paused_reason: "Account deleted" });
  await store.settings.remove(user.id);
  await store.users.remove(user.id); // cascades to brokers, bots, trades, signals, logs and equity
  await log("info", "An account was deleted", { user_id: null });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("amogana_session");
  return response;
});
