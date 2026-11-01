import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { emailEnabled } from "@/lib/auth/email";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE, checkEnvPassword, readSessionToken } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";
import { randomToken, sha256 } from "@/lib/secrets";
import { getStore, newId, nowIso } from "@/lib/trading/store";
import type { AuthToken, User } from "@/lib/trading/types";

export const OWNER_ID = "owner";
export const MIN_PASSWORD_LENGTH = 10;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function adminEmails(): Set<string> {
  return new Set((process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean));
}

export async function getUser(id: string): Promise<User | null> {
  return getStore().users.get(id);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await getStore().users.all({ eq: { email: normalizeEmail(email) }, limit: 1 });
  return user ?? null;
}

export class SignupError extends Error {}

export async function createUser(input: { email: string; password: string; display_name?: string | null }): Promise<User> {
  const email = normalizeEmail(input.email);
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new SignupError("PASSWORD_TOO_SHORT");
  if (await getUserByEmail(email)) throw new SignupError("EMAIL_TAKEN");
  const now = nowIso();
  const user: User = {
    id: newId(),
    email,
    display_name: input.display_name?.trim() || null,
    password_hash: await hashPassword(input.password),
    role: adminEmails().has(email) ? "admin" : "user",
    // Without an email provider there is no way to verify, so the address is taken on trust.
    email_verified_at: emailEnabled() ? null : now,
    session_version: 1,
    disabled: false,
    accepted_terms_at: now,
    password_changed_at: now,
    last_login_at: now,
    created_at: now,
    updated_at: now,
  };
  try {
    return await getStore().users.insert(user);
  } catch {
    throw new SignupError("EMAIL_TAKEN"); // unique index: created concurrently
  }
}

/**
 * Email + password sign-in. With no email, only the original owner can sign in,
 * and only until they add an email (their password, or APP_PASSWORD if they never set one).
 */
export async function authenticate(email: string | null, password: string): Promise<User | null> {
  let user: User | null;
  if (email) {
    user = await getUserByEmail(email);
    if (user && !user.password_hash && user.id === OWNER_ID) {
      // The original owner who never replaced APP_PASSWORD.
      if (!(await checkEnvPassword(password))) return null;
    } else if (!user?.password_hash) {
      // Spend similar time whether or not the account exists.
      await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
      return null;
    } else if (!(await verifyPassword(password, user.password_hash))) {
      return null;
    }
  } else {
    user = await getUser(OWNER_ID);
    if (!user || user.email) return null;
    const ok = user.password_hash ? await verifyPassword(password, user.password_hash) : await checkEnvPassword(password);
    if (!ok) return null;
  }
  if (user.disabled) return null;
  return (await getStore().users.update(user.id, { last_login_at: nowIso() })) ?? user;
}

export async function updateUser(id: string, patch: Partial<User>): Promise<User> {
  const updated = await getStore().users.update(id, { ...patch, updated_at: nowIso() });
  if (!updated) throw new Error("User not found");
  return updated;
}

/** Ends every session of this user (other devices included). Returns the updated user. */
export async function bumpSessions(user: User, patch: Partial<User> = {}): Promise<User> {
  return updateUser(user.id, { ...patch, session_version: user.session_version + 1 });
}

// ---------------------------------------------------------------------------
// One-time email links

const TOKEN_TTL: Record<AuthToken["kind"], number> = { verify_email: 48 * 3600_000, reset_password: 3600_000 };

export async function issueToken(userId: string, kind: AuthToken["kind"]): Promise<string> {
  const raw = randomToken(32);
  await getStore().auth_tokens.insert({
    id: sha256(raw),
    user_id: userId,
    kind,
    expires_at: new Date(Date.now() + TOKEN_TTL[kind]).toISOString(),
    used_at: null,
    created_at: nowIso(),
  });
  return raw;
}

/** Marks a valid, unused, unexpired token as used and returns its user. */
export async function consumeToken(raw: string, kind: AuthToken["kind"]): Promise<User | null> {
  const store = getStore();
  const token = await store.auth_tokens.get(sha256(raw));
  if (!token || token.kind !== kind || token.used_at || token.expires_at < nowIso()) return null;
  await store.auth_tokens.update(token.id, { used_at: nowIso() });
  const user = await getUser(token.user_id);
  return user && !user.disabled ? user : null;
}

// ---------------------------------------------------------------------------
// Request helpers

/** The signed-in user for this request, or null (expired, signed out elsewhere, or disabled). */
export async function getSessionUser(): Promise<User | null> {
  const claims = await readSessionToken(cookies().get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const user = await getUser(claims.userId);
  if (!user || user.disabled || user.session_version !== claims.version) return null;
  return user;
}

type Handler<C> = (user: User, request: Request, context: C) => Promise<Response>;

/** Wraps an API route so it only runs for a signed-in user. */
export function withUser<C = { params: Record<string, string> }>(handler: Handler<C>) {
  return async (request: Request, context: C): Promise<Response> => {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    return handler(user, request, context);
  };
}

export function withAdmin<C = { params: Record<string, string> }>(handler: Handler<C>) {
  return withUser<C>(async (user, request, context) => {
    if (user.role !== "admin") return jsonError(403, "ADMIN_ONLY");
    return handler(user, request, context);
  });
}

/** Connecting brokers needs a confirmed email once email sending is configured. */
export function needsVerifiedEmail(user: User): Response | null {
  if (emailEnabled() && !user.email_verified_at) return jsonError(403, "EMAIL_NOT_VERIFIED");
  if (!user.email) return jsonError(403, "ADD_EMAIL_FIRST");
  return null;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    email_verified: Boolean(user.email_verified_at),
    password_set: Boolean(user.password_hash),
    password_changed_at: user.password_changed_at,
    created_at: user.created_at,
    email_enabled: emailEnabled(),
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

// ---------------------------------------------------------------------------
// Simple fixed-window rate limit (per server instance) for sign-in and sign-up.

const hits = new Map<string, { count: number; reset: number }>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > max;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
