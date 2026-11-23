import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createUser } from "@/lib/auth/users";
import { localTime, runDailySummaries, summaryText } from "@/lib/push-summary";
import { getStore, newId, resetStore } from "@/lib/trading/store";
import type { PushDevice, Trade } from "@/lib/trading/types";

const trade = (over: Partial<Trade>): Trade =>
  ({ id: newId(), user_id: "u", book: "demo", status: "closed", pnl: 0, symbol: "frxXAUUSD", closed_at: null, ...over }) as Trade;

describe("local time", () => {
  it("gives the device's own date and hour, UTC for an unknown zone", () => {
    const at = new Date("2026-11-23T19:30:00Z");
    expect(localTime(at, "Africa/Johannesburg")).toEqual({ date: "2026-11-23", hour: 21 });
    expect(localTime(at, "Asia/Tokyo")).toEqual({ date: "2026-11-24", hour: 4 });
    expect(localTime(at, "America/New_York")).toEqual({ date: "2026-11-23", hour: 14 });
    expect(localTime(at, "Not/AZone")).toEqual({ date: "2026-11-23", hour: 19 });
    expect(localTime(at, null)).toEqual({ date: "2026-11-23", hour: 19 });
  });
});

describe("summary text", () => {
  const usd = () => "USD";
  it("one line per book with activity, real money first", () => {
    const closed = [trade({ pnl: 10 }), trade({ pnl: -2.5 }), trade({ pnl: 4.9 }), trade({ book: "real", pnl: -1 })];
    const open = [trade({ status: "open" }), trade({ status: "open" })];
    expect(summaryText(closed, open, usd)).toBe("Real: 1 trade closed, 0 won, −1.00 USD\nDemo: 3 trades closed, 2 won, +12.40 USD · 2 open");
  });
  it("open positions alone still count; a quiet day says nothing", () => {
    expect(summaryText([], [trade({ status: "open", book: "real" })], () => null)).toBe("Real: no trades closed · 1 open");
    expect(summaryText([], [], usd)).toBeNull();
  });
});

describe("daily summaries", () => {
  const sent: Array<{ id: string; payload: Record<string, string> }> = [];
  const send = async (d: PushDevice, payload: string) => {
    sent.push({ id: d.id, payload: JSON.parse(payload) });
  };
  let userId = "";

  beforeEach(async () => {
    process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-summary-")), "store.json");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    resetStore();
    sent.length = 0;
    userId = (await createUser({ email: "ann@example.com", password: "a long password" })).id;
    const store = getStore();
    const base = { user_id: userId, endpoint: "", p256dh: "k", auth: "a", label: null, created_at: "2026-11-01T00:00:00Z", last_sent_at: null };
    await store.push_devices.insert({ ...base, id: "sa-phone", endpoint: "e1", topics: { alerts: true, trades: true }, timezone: "Africa/Johannesburg" });
    await store.push_devices.insert({ ...base, id: "no-summary", endpoint: "e2", topics: { alerts: true, trades: true, summary: false }, timezone: "Africa/Johannesburg" });
    await store.push_devices.insert({ ...base, id: "ny-laptop", endpoint: "e3", topics: { alerts: true, trades: true }, timezone: "America/New_York" });
    await store.brokers.insert({ id: "b1", user_id: userId, is_demo: true, currency: "USD" } as never);
    for (const [pnl, closed_at] of [
      [10, "2026-11-23T08:00:00Z"],
      [-4, "2026-11-23T15:00:00Z"],
      [99, "2026-11-22T21:30:00Z"], // yesterday in Johannesburg (23:30 on the 22nd)
    ] as const) {
      await store.trades.insert(trade({ user_id: userId, pnl, closed_at, broker_account_id: "b1" }));
    }
    await store.trades.insert(trade({ user_id: userId, status: "open", broker_account_id: "b1" }));
  });

  it("sends once per local evening, only to devices that want it", async () => {
    expect(await runDailySummaries(new Date("2026-11-23T18:30:00Z"), { send })).toBe(0); // 20:30 in SA
    expect(await runDailySummaries(new Date("2026-11-23T19:01:00Z"), { send })).toBe(1); // 21:01 in SA
    expect(sent[0]).toMatchObject({
      id: "sa-phone",
      payload: { title: "Today on binaryTrades", body: "Demo: 2 trades closed, 1 won, +6.00 USD · 1 open", url: "/dashboard/trades" },
    });
    expect(await runDailySummaries(new Date("2026-11-23T19:02:00Z"), { send })).toBe(0); // already sent today
    // New York's evening comes later, with New York's "today" (the 22nd 21:30 UTC was the 22nd there too).
    expect(await runDailySummaries(new Date("2026-11-24T02:00:00Z"), { send })).toBe(1); // 21:00 in New York
    expect(sent[1]).toMatchObject({ id: "ny-laptop", payload: { body: "Demo: 2 trades closed, 1 won, +6.00 USD · 1 open" } });
    expect(sent.map((s) => s.id)).not.toContain("no-summary");
  });

  it("a quiet day sends nothing and isn't retried every minute", async () => {
    const store = getStore();
    for (const t of await store.trades.all()) await store.trades.remove(t.id);
    expect(await runDailySummaries(new Date("2026-11-23T19:05:00Z"), { send })).toBe(0);
    expect((await store.push_devices.get("sa-phone"))!.summary_sent_on).toBe("2026-11-23");
    expect(sent).toHaveLength(0);
  });
});
