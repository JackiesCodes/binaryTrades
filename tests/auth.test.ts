import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import { SignupError, authenticate, consumeToken, createUser, issueToken, updateUser } from "@/lib/auth/users";
import { getStore, nowIso, resetStore } from "@/lib/trading/store";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-auth-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.RESEND_API_KEY;
  process.env.APP_PASSWORD = "env-password";
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  process.env.ADMIN_EMAILS = "Boss@Example.com";
  resetStore();
});

async function owner(patch: Record<string, unknown> = {}) {
  const now = nowIso();
  return getStore().users.insert({
    id: "owner", email: null, display_name: null, password_hash: null, role: "admin", email_verified_at: null,
    session_version: 1, disabled: false, accepted_terms_at: null, password_changed_at: null, last_login_at: null,
    created_at: now, updated_at: now, ...patch,
  });
}

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("accounts", () => {
  it("signs up, signs in by email (any case), and refuses duplicates and short passwords", async () => {
    const u = await createUser({ email: "Ann@Example.com", password: "a long password" });
    expect(u).toMatchObject({ email: "ann@example.com", role: "user" });
    expect(u.email_verified_at).not.toBeNull(); // no email provider configured: trusted
    expect((await authenticate("ANN@example.com", "a long password"))?.id).toBe(u.id);
    expect(await authenticate("ann@example.com", "wrong password")).toBeNull();
    expect(await authenticate("nobody@example.com", "a long password")).toBeNull();
    await expect(createUser({ email: "ann@example.com", password: "another long one" })).rejects.toThrow(SignupError);
    await expect(createUser({ email: "bob@example.com", password: "short" })).rejects.toThrow("PASSWORD_TOO_SHORT");
  });

  it("makes ADMIN_EMAILS admins and blocks disabled accounts", async () => {
    const boss = await createUser({ email: "boss@example.com", password: "a long password" });
    expect(boss.role).toBe("admin");
    await updateUser(boss.id, { disabled: true });
    expect(await authenticate("boss@example.com", "a long password")).toBeNull();
  });

  it("lets the original owner sign in with only a password until they add an email", async () => {
    await owner();
    expect((await authenticate(null, "env-password"))?.id).toBe("owner");
    expect(await authenticate(null, "wrong")).toBeNull();
    await updateUser("owner", { email: "me@example.com" });
    expect((await authenticate("me@example.com", "env-password"))?.id).toBe("owner");
    await updateUser("owner", { email: "me@example.com", password_hash: await hashPassword("my own password") });
    expect(await authenticate(null, "env-password")).toBeNull();
    expect(await authenticate(null, "my own password")).toBeNull();
    expect((await authenticate("me@example.com", "my own password"))?.id).toBe("owner");
  });

  it("uses email links once, and only before they expire", async () => {
    const u = await createUser({ email: "cat@example.com", password: "a long password" });
    const raw = await issueToken(u.id, "reset_password");
    expect(await consumeToken(raw, "verify_email")).toBeNull(); // wrong kind
    expect((await consumeToken(raw, "reset_password"))?.id).toBe(u.id);
    expect(await consumeToken(raw, "reset_password")).toBeNull(); // used
    const old = await issueToken(u.id, "verify_email");
    const [row] = await getStore().auth_tokens.all({ eq: { kind: "verify_email" } });
    await getStore().auth_tokens.update(row!.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await consumeToken(old, "verify_email")).toBeNull();
  });
});

describe("sessions", () => {
  it("carries a signed user and version", async () => {
    const { value } = await createSessionToken("user-1", 3);
    expect(await readSessionToken(value)).toEqual({ userId: "user-1", version: 3 });
    const [exp, , ver, sig] = value.split(".");
    expect(await readSessionToken(`${exp}.user-2.${ver}.${sig}`)).toBeNull(); // can't switch users
    expect(await readSessionToken(`${exp}.user-1.4.${sig}`)).toBeNull(); // or raise the version
  });

  it("maps cookies from the single-owner version to the owner", async () => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sign = async (m: string) => Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(m))).toString("hex");
    const exp = String(Math.floor(Date.now() / 1000) + 3600);
    expect(await readSessionToken(`${exp}.${await sign(exp)}`)).toEqual({ userId: "owner", version: 1 });
    expect(await readSessionToken(`${exp}.2.${await sign(`${exp}.2`)}`)).toEqual({ userId: "owner", version: 2 });
  });

  it("rejects expired and malformed cookies", async () => {
    expect(await readSessionToken("1.u.1.abc")).toBeNull();
    expect(await readSessionToken("nonsense")).toBeNull();
    expect(await readSessionToken(undefined)).toBeNull();
  });
});
