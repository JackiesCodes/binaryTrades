import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { checkLoginPassword, getProfile } from "@/lib/auth/account";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import { getStore, resetStore } from "@/lib/trading/store";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-auth-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.APP_PASSWORD = "env-password";
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
});

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

  it("uses APP_PASSWORD until the owner sets a password, then only the new one", async () => {
    expect(await checkLoginPassword("env-password")).toBe(true);
    await getProfile();
    await getStore().profile.update("owner", { password_hash: await hashPassword("my new password") });
    expect(await checkLoginPassword("env-password")).toBe(false);
    expect(await checkLoginPassword("my new password")).toBe(true);
  });
});

describe("sessions", () => {
  it("carries a signed version", async () => {
    const { value } = await createSessionToken(3);
    expect(await readSessionToken(value)).toEqual({ version: 3 });
    const [exp, , sig] = value.split(".");
    expect(await readSessionToken(`${exp}.4.${sig}`)).toBeNull(); // can't raise the version without the secret
  });

  it("accepts cookies issued before versions existed as version 1", async () => {
    const { value } = await createSessionToken(1);
    const [exp] = value.split(".");
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, enc.encode(exp))).toString("hex");
    expect(await readSessionToken(`${exp}.${sig}`)).toEqual({ version: 1 });
  });

  it("rejects expired and malformed cookies", async () => {
    expect(await readSessionToken("1.1.abc")).toBeNull();
    expect(await readSessionToken("nonsense")).toBeNull();
    expect(await readSessionToken(undefined)).toBeNull();
  });
});
