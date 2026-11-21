import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { alertHitInCandles, keepServerFired, newAlert, type MinuteCandle, type PriceAlert } from "@/lib/markets/alerts";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { PUT } from "@/app/api/markets/state/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser, updateUser } from "@/lib/auth/users";
import { checkPriceAlerts } from "@/lib/markets/server-alerts";
import { deps, runEngineTick } from "@/lib/trading/engine";
import { getStore, nowIso, resetStore } from "@/lib/trading/store";

const T0 = Date.UTC(2026, 10, 21, 12, 0, 30); // alerts set at 12:00:30
const at = (min: number) => Math.floor(T0 / 1000 / 60) * 60 + min * 60; // candle start, minutes after 12:00
const c = (min: number, high: number, low: number, close: number): MinuteCandle => ({ time: at(min), high, low, close });
const alert = (op: PriceAlert["op"], price: number, symbol = "binance:BTCUSDT", email = true) => newAlert(symbol, op, price, new Date(T0), email);

describe("alert check on 1-minute candles", () => {
  it("fires on a spike in a later minute, even if the price has come back", () => {
    expect(alertHitInCandles(alert("above", 100), [c(1, 101, 95, 96), c(2, 97, 94, 95)])).toBe(101);
    expect(alertHitInCandles(alert("below", 90), [c(1, 99, 89.5, 95)])).toBe(89.5);
  });

  it("ignores the minute the alert was set in (except its latest price) and anything earlier", () => {
    expect(alertHitInCandles(alert("above", 100), [c(-1, 150, 90, 95), c(0, 120, 90, 95)])).toBeNull();
    expect(alertHitInCandles(alert("above", 100), [c(0, 120, 90, 101)])).toBe(101); // latest price is past it
    expect(alertHitInCandles({ ...alert("above", 100), triggered_at: nowIso() }, [c(2, 200, 1, 150)])).toBeNull();
    expect(alertHitInCandles(alert("above", 100), [])).toBeNull();
  });

  it("a page saving an older copy can't un-fire an alert the server fired", () => {
    const a = alert("above", 100);
    const fired = { ...a, triggered_at: nowIso(), triggered_price: 101 };
    const b = alert("below", 50);
    expect(keepServerFired([a, b], [fired])).toEqual([fired, b]);
    expect(keepServerFired([b], [fired])).toEqual([b]); // deleted on the page: stays deleted
  });
});

const sent: Array<{ to: string[]; subject: string; html: string }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-alerts-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
  cookie = undefined;
  sent.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

async function userWithAlerts(email: string, alerts: PriceAlert[]) {
  const u = await createUser({ email, password: "a long password" });
  await getStore().markets_state.insert({ id: u.id, user_id: u.id, watchlist: null, indicators: null, drawings: null, alerts, updated_at: nowIso() });
  return u;
}
const alertsOf = async (id: string) => ((await getStore().markets_state.get(id))!.alerts ?? []) as PriceAlert[];

describe("server price alerts (every minute)", () => {
  it("fires reached alerts once, logs them, and emails verified users who asked", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "binaryTrades <no-reply@example.com>";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("resend.com")) {
        sent.push(JSON.parse(String(init!.body)));
        return new Response("{}", { status: 200 });
      }
      throw new Error("unexpected fetch " + url);
    }) as typeof fetch;

    const ann = await userWithAlerts("ann@example.com", [alert("above", 100), alert("below", 10, "deriv:R_100", false), alert("above", 500)]);
    await updateUser(ann.id, { email_verified_at: nowIso() }); // only confirmed addresses get alert emails
    const bob = await userWithAlerts("bob@example.com", [alert("below", 90)]);
    const cy = await userWithAlerts("cy@example.com", [alert("above", 101)]); // fires, but email not confirmed
    const asked: string[][] = [];
    const feed = vi.fn(async (ids: string[]) => {
      asked.push([...ids].sort());
      return new Map([
        ["binance:BTCUSDT", [c(1, 102, 95, 96)]],
        ["deriv:R_100", [c(1, 12, 9, 11)]],
      ]);
    });

    expect(await checkPriceAlerts(feed)).toEqual({ waiting: 5, fired: 3 });
    expect(asked[0]).toEqual(["binance:BTCUSDT", "deriv:R_100"]); // each market fetched once for everyone
    expect((await alertsOf(cy.id))[0]!.triggered_price).toBe(102);
    const a = await alertsOf(ann.id);
    expect(a.filter((x) => x.triggered_at).map((x) => [x.op, x.price, x.triggered_price])).toEqual([
      ["above", 100, 102],
      ["below", 10, 9],
    ]);
    expect(a.find((x) => x.price === 500)!.triggered_at).toBeNull();
    expect((await alertsOf(bob.id))[0]!.triggered_at).toBeNull(); // 95 never went below 90

    const logs = await getStore().logs.all({ eq: { level: "alert" } });
    expect(logs.filter((l) => l.user_id === ann.id).map((l) => l.message).sort()).toEqual([
      "Price alert: BTC/USDT went above 100.000 (reached 102.000)",
      "Price alert: Volatility 100 Index went below 10.00 (reached 9.00)",
    ]);
    expect(logs.filter((l) => l.user_id === cy.id)).toHaveLength(1);
    // One email, only for the alert that asked for one.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["ann@example.com"]);
    expect(sent[0]!.subject).toBe("Price alert: BTC/USDT went above 100.000 (reached 102.000)");
    expect(sent[0]!.html).toContain("/dashboard/markets");

    // Next minute: nothing fires twice.
    expect(await checkPriceAlerts(feed)).toEqual({ waiting: 2, fired: 0 });
    expect(asked[1]).toEqual(["binance:BTCUSDT"]); // only markets with alerts still waiting
    expect(sent).toHaveLength(1);
  });

  it("skips disabled users, keeps changes saved meanwhile, and does nothing without waiting alerts", async () => {
    const feedNone = vi.fn(async () => new Map());
    expect(await checkPriceAlerts(feedNone)).toEqual({ waiting: 0, fired: 0 });
    expect(feedNone).not.toHaveBeenCalled();

    const off = await userWithAlerts("off@example.com", [alert("above", 100)]);
    await updateUser(off.id, { disabled: true });
    const ann = await userWithAlerts("ann@example.com", [alert("above", 100)]);
    const added = alert("below", 1, "binance:ETHUSDT");
    const feed = async () => {
      // The page saves a new alert while the server is checking prices.
      const row = (await getStore().markets_state.get(ann.id))!;
      await getStore().markets_state.update(ann.id, { alerts: [...(row.alerts as PriceAlert[]), added] });
      return new Map([["binance:BTCUSDT", [c(1, 150, 140, 145)]]]);
    };
    expect((await checkPriceAlerts(feed)).fired).toBe(1);
    expect((await alertsOf(off.id))[0]!.triggered_at).toBeNull();
    const a = await alertsOf(ann.id);
    expect(a.map((x) => [x.id, Boolean(x.triggered_at)])).toEqual([
      [added.id, false],
      [a.find((x) => x.op === "above")!.id, true],
    ]);
    expect(sent).toHaveLength(0); // email not configured
  });

  it("an older copy saved from the page keeps the server's fired alert fired", async () => {
    const ann = await userWithAlerts("ann@example.com", []);
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const a = alert("above", 100);
    await getStore().markets_state.update(ann.id, { alerts: [{ ...a, triggered_at: nowIso(), triggered_price: 101 }] });
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ alerts: [a, alert("below", 5)] }) }), { params: {} });
    expect(res.status).toBe(200);
    const saved = await alertsOf(ann.id);
    expect(saved.find((x) => x.id === a.id)!.triggered_price).toBe(101);
    expect(saved).toHaveLength(2);
  });

  it("runs as part of the engine tick", async () => {
    const original = deps.checkPriceAlerts;
    deps.checkPriceAlerts = async () => ({ waiting: 3, fired: 1 });
    try {
      expect((await runEngineTick()).alerts).toEqual({ waiting: 3, fired: 1 });
      deps.checkPriceAlerts = async () => {
        throw new Error("feed down");
      };
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      expect((await runEngineTick()).alerts).toBeUndefined(); // a feed problem never stops the tick
      err.mockRestore();
    } finally {
      deps.checkPriceAlerts = original;
    }
  });
});
