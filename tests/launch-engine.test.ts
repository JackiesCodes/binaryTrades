import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { POST as dashboardTick } from "@/app/api/engine/tick/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { forEachLimited } from "@/lib/trading/engine";
import { getStore, resetStore } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

describe("running users side by side", () => {
  it("does every item, never more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await forEachLimited(Array.from({ length: 25 }, (_, i) => i), 10, async (i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 + (i % 3)));
      done.push(i);
      running--;
    });
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(peak).toBe(10);
    await forEachLimited([], 10, async () => undefined); // nothing to do: fine
  });
});

describe("dashboard tick with the scheduler set up", () => {
  beforeEach(() => {
    process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-tick-")), "store.json");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SESSION_SECRET = "test-session-secret-0123456789";
    process.env.CRON_SECRET = "cron-secret-for-tests";
    resetStore();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("doesn't run bots itself, and reports when the scheduler last checked them", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    await getStore().bots.insert({ id: "b1", user_id: ann.id, name: "Gold", status: "running", source: "builtin", last_check: { at: "2026-11-24T08:01:00.000Z", result: "waiting for next bar" } } as Bot);
    await getStore().bots.insert({ id: "b2", user_id: ann.id, name: "Old", status: "paused", source: "builtin", last_check: { at: "2026-11-24T09:00:00.000Z", result: "hold" } } as Bot);
    const body = await (await dashboardTick(new Request("http://localhost/api/engine/tick", { method: "POST" }), { params: {} })).json();
    expect(body).toMatchObject({ at: "2026-11-24T08:01:00.000Z", bots: {}, scheduler: true });
    // No running bots: nothing to wait for.
    await getStore().bots.update("b1", { status: "paused" });
    const quiet = await (await dashboardTick(new Request("http://localhost/api/engine/tick", { method: "POST" }), { params: {} })).json();
    expect(Date.now() - Date.parse(quiet.at)).toBeLessThan(5000);
  });
});
