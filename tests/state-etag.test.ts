import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { GET } from "@/app/api/state/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { thinPoints } from "@/lib/trading/state";
import { getStore, log, resetStore } from "@/lib/trading/store";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-state-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.RESEND_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
});

describe("dashboard state polling", () => {
  it("thins long equity histories, keeping the first and newest points", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => i);
    const thin = thinPoints(pts, 400);
    expect(thin).toHaveLength(400);
    expect(thin[0]).toBe(0);
    expect(thin.at(-1)).toBe(4999);
    expect([...thin].sort((a, b) => a - b)).toEqual(thin); // order kept
    expect(thinPoints([1, 2, 3], 400)).toEqual([1, 2, 3]);
  });

  it("answers an unchanged state with an empty 304, and sends it again once something changes", async () => {
    const u = await createUser({ email: "ann@example.com", password: "a long password" });
    cookie = (await createSessionToken(u.id, u.session_version)).value;
    const get = (etag?: string) => GET(new Request("http://x/api/state", { headers: etag ? { "if-none-match": etag } : {} }), { params: {} });

    const first = await get();
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^".+"$/);
    expect((await first.json()).settings).toBeTruthy();

    // Nothing changed (only the time it was generated): no body.
    const same = await get(etag);
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");

    // Something changed: the whole state again, with a new fingerprint.
    await log("info", "something happened", { user_id: u.id });
    const changed = await get(etag);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    expect((await get("\"stale\"")).status).toBe(200);
    // A compressing proxy may turn the fingerprint into a weak one: still recognised.
    const now = (await get()).headers.get("etag")!;
    expect((await get(`W/${now}`)).status).toBe(304);
    expect(getStore().backend).toBe("file");
  });
});
