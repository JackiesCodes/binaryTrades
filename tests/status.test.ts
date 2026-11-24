import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/status/route";
import { getStore, resetStore } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-status-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  resetStore();
});

const bot = (id: string, status: Bot["status"], checkedAgoMin: number | null) =>
  getStore().bots.insert({ id, user_id: "u", name: id, status, last_check: checkedAgoMin === null ? null : { at: new Date(Date.now() - checkedAgoMin * 60_000).toISOString(), result: "hold" } } as Bot);

describe("/api/status", () => {
  it("ok while running bots are being checked; idle with none running", async () => {
    let res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, database: "ok", engine: "idle" });
    await bot("a", "running", 2);
    await bot("b", "paused", 300); // paused bots don't count
    await bot("c", "running", null); // just started, not checked yet: no false alarm
    res = await GET();
    expect(await res.json()).toMatchObject({ ok: true, engine: "ok" });
  });

  it("503 when no running bot has been checked for 10 minutes, and says nothing about accounts", async () => {
    await bot("a", "running", 25);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, engine: "stale" });
    expect(Object.keys(body).sort()).toEqual(["at", "database", "engine", "ok"]);
  });
});
