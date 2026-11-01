// Edge-compatible (Web Crypto only): imported by middleware.ts.

export const SESSION_COOKIE = "amogana_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || null;
}

/** Sessions can be signed: SESSION_SECRET (or, for older installs, APP_PASSWORD) is set. */
export function isAuthConfigured(): boolean {
  return Boolean(sessionSecret());
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SessionClaims {
  userId: string;
  /** Must equal the user's current session_version (checked server-side on every API call). */
  version: number;
}

/** Cookie value: `${expires}.${userId}.${version}.${hmac}`. */
export async function createSessionToken(userId: string, version: number): Promise<{ value: string; maxAge: number }> {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  if (!/^[A-Za-z0-9-]+$/.test(userId)) throw new Error("Invalid user id");
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expires}.${userId}.${version}`;
  return { value: `${payload}.${await hmacHex(secret, payload)}`, maxAge: SESSION_TTL_SECONDS };
}

/** The signed claims of a genuine, unexpired cookie, otherwise null. Does not check the database. */
export async function readSessionToken(token: string | undefined): Promise<SessionClaims | null> {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  let expires: string | undefined, userId: string | undefined, version: string | undefined, sig: string | undefined, payload: string;
  if (parts.length === 4) {
    [expires, userId, version, sig] = parts;
    payload = `${expires}.${userId}.${version}`;
  } else if (parts.length === 3) {
    // Single-owner cookies ("expires.version.sig") belong to the original owner.
    [expires, version, sig] = parts;
    userId = "owner";
    payload = `${expires}.${version}`;
  } else if (parts.length === 2) {
    [expires, sig] = parts;
    userId = "owner";
    version = "1";
    payload = expires ?? "";
  } else {
    return null;
  }
  if (!expires || !userId || !version || !sig || Number(expires) < Date.now() / 1000) return null;
  if (!constantTimeEqual(sig, await hmacHex(secret, payload))) return null;
  const v = Number(version);
  return Number.isInteger(v) && v > 0 ? { userId, version: v } : null;
}

/** Compares against APP_PASSWORD (the original owner's password until they set their own). */
export async function checkEnvPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  // Compare HMACs so the comparison length never leaks the password length.
  const [a, b] = await Promise.all([hmacHex("pw", candidate), hmacHex("pw", password)]);
  return constantTimeEqual(a, b);
}
