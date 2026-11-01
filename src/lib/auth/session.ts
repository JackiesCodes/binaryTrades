// Edge-compatible (Web Crypto only): imported by middleware.ts.

export const SESSION_COOKIE = "amogana_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function sessionSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || null;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
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

/**
 * Cookie value: `${expires}.${version}.${hmac}`. `version` must match the owner's
 * current session_version, so bumping it (password change, "sign out other
 * devices") ends every older session.
 */
export async function createSessionToken(version = 1): Promise<{ value: string; maxAge: number }> {
  const secret = sessionSecret();
  if (!secret) throw new Error("APP_PASSWORD is not configured");
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expires}.${version}`;
  return { value: `${payload}.${await hmacHex(secret, payload)}`, maxAge: SESSION_TTL_SECONDS };
}

/** Returns the session's version when the cookie is genuine and unexpired, otherwise null. */
export async function readSessionToken(token: string | undefined): Promise<{ version: number } | null> {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  // Cookies issued before session versions existed ("expires.sig") count as version 1.
  const [expires, version, sig] = parts.length === 2 ? [parts[0], "1", parts[1]] : parts;
  if (parts.length > 3 || !expires || !version || !sig || Number(expires) < Date.now() / 1000) return null;
  const payload = parts.length === 2 ? expires : `${expires}.${version}`;
  if (!constantTimeEqual(sig, await hmacHex(secret, payload))) return null;
  const v = Number(version);
  return Number.isInteger(v) && v > 0 ? { version: v } : null;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

/** Compares against APP_PASSWORD (used until the owner sets their own password). */
export async function checkEnvPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  // Compare HMACs so the comparison length never leaks the password length.
  const [a, b] = await Promise.all([hmacHex("pw", candidate), hmacHex("pw", password)]);
  return constantTimeEqual(a, b);
}
