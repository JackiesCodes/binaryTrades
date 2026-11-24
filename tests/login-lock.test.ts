import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));

import { POST as login } from "@/app/api/auth/login/route";
import { createUser } from "@/lib/auth/users";
import { getStore, resetStore } from "@/lib/trading/store";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-lock-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
});

// Each attempt from a different address, as a spread-out attacker would (so only the account lock applies).
let ip = 0;
const attempt = (password: string) =>
  login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${++ip % 250}` },
      body: JSON.stringify({ email: "Ann@Example.com", password }),
    }),
  );

describe("sign-in lock per account", () => {
  it("locks an account after 10 failures in 15 minutes, across servers, and tells its owner", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "the right password" });
    // Simulate earlier failures seen by other servers: they're in the shared log, not this server's memory.
    for (let i = 0; i < 9; i++) await getStore().logs.insert({ id: `f${i}`, user_id: ann.id, level: "warn", message: "Failed sign-in attempt", bot_id: null, context: null, created_at: new Date().toISOString() });
    expect((await attempt("wrong")).status).toBe(401); // the 10th failure
    expect((await attempt("the right password")).status).toBe(429); // locked, even with the right password
    const failed = (await getStore().logs.all()).filter((l) => l.message === "Failed sign-in attempt" && l.user_id === ann.id);
    expect(failed).toHaveLength(10);
    expect(failed.some((l) => (l.context as { ip?: string } | null)?.ip?.startsWith("203.0.113."))).toBe(true);
  }, 20_000);

  it("old failures don't count, and the right password still works below the limit", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "the right password" });
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    for (let i = 0; i < 12; i++) await getStore().logs.insert({ id: `o${i}`, user_id: ann.id, level: "warn", message: "Failed sign-in attempt", bot_id: null, context: null, created_at: old });
    expect((await attempt("the right password")).status).toBe(200);
  });
});
