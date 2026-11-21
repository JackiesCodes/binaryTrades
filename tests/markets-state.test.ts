import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ACTIVE_ALERTS, MAX_ALERT_HISTORY, activeAlerts, alertHit, alertProblem, newAlert, sanitizeAlerts, suggestedOp } from "@/lib/markets/alerts";
import { sanitizePart } from "@/lib/markets/state";

// The API reads the session cookie through next/headers; the test sets which user is signed in.
let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { GET, PUT } from "@/app/api/markets/state/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { getStore, resetStore } from "@/lib/trading/store";

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-markets-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.RESEND_API_KEY;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
  cookie = undefined;
});

describe("price alerts", () => {
  it("fire at or beyond their level, once", () => {
    const up = newAlert("binance:BTCUSDT", "above", 100);
    expect(alertHit(up, 99.9)).toBe(false);
    expect(alertHit(up, 100)).toBe(true);
    expect(alertHit({ ...up, triggered_at: new Date().toISOString() }, 150)).toBe(false);
    const down = newAlert("deriv:R_100", "below", 50);
    expect(alertHit(down, 50.1)).toBe(false);
    expect(alertHit(down, 49)).toBe(true);
    expect(alertHit(down, NaN)).toBe(false);
  });

  it("refuse a level the price is already past, and suggest the direction", () => {
    expect(alertProblem("above", 100, 120)).toMatch(/already/);
    expect(alertProblem("below", 100, 80)).toMatch(/already/);
    expect(alertProblem("above", 130, 120)).toBeNull();
    expect(alertProblem("above", 0, 120)).toMatch(/above 0/);
    expect(alertProblem("below", 10, null)).toBeNull();
    expect(suggestedOp(130, 120)).toBe("above");
    expect(suggestedOp(110, 120)).toBe("below");
  });

  it("are repaired and capped when read back", () => {
    const fired = { ...newAlert("binance:ETHUSDT", "above", 10), triggered_at: "2026-11-20T10:00:00.000Z", triggered_price: 10.5 };
    const list = sanitizeAlerts([
      newAlert("binance:BTCUSDT", "above", 100),
      fired,
      { symbol: "evil:<x>", op: "above", price: 1 },
      { symbol: "binance:BTCUSDT", op: "sideways", price: 1 },
      { symbol: "binance:BTCUSDT", op: "below", price: -5 },
      ...Array.from({ length: 70 }, (_, i) => newAlert("deriv:R_100", "below", 10 + i)),
      ...Array.from({ length: 40 }, () => ({ ...fired, id: undefined })),
    ]);
    expect(activeAlerts(list)).toHaveLength(MAX_ACTIVE_ALERTS);
    expect(list.filter((a) => a.triggered_at)).toHaveLength(MAX_ALERT_HISTORY);
    expect(list.find((a) => a.id === fired.id)).toMatchObject({ triggered_price: 10.5 });
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
  });

  it("the watchlist part drops anything that isn't a market id", () => {
    expect(sanitizePart("watchlist", ["binance:BTCUSDT", "javascript:alert(1)"])).toEqual(["binance:BTCUSDT"]);
  });
});

async function signIn(email: string) {
  const u = await createUser({ email, password: "a long password" });
  cookie = (await createSessionToken(u.id, u.session_version)).value;
  return u;
}
const put = (body: unknown) => PUT(new Request("http://x/api/markets/state", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }), { params: {} });
const get = async () => (await GET(new Request("http://x/api/markets/state"), { params: {} })).json();

describe("saved Markets page (API)", () => {
  it("needs a signed-in user", async () => {
    expect((await GET(new Request("http://x"), { params: {} })).status).toBe(401);
    expect((await put({ watchlist: [] })).status).toBe(401);
  });

  it("starts empty, saves the parts sent, repairs them, and keeps the rest", async () => {
    await signIn("ann@example.com");
    expect(await get()).toEqual({ watchlist: null, indicators: null, drawings: null, alerts: null, updated_at: null });

    const r1 = await put({ watchlist: ["binance:BTCUSDT", "bad id"], indicators: [{ type: "ema", period: 9999 }] });
    expect(r1.status).toBe(200);
    const s1 = await get();
    expect(s1.watchlist).toEqual(["binance:BTCUSDT"]);
    expect(s1.indicators[0]).toMatchObject({ type: "ema", period: 500 });
    expect(s1.alerts).toBeNull();

    await put({ alerts: [newAlert("binance:BTCUSDT", "above", 70000)], drawings: { "binance:BTCUSDT": [{ type: "hline", points: [{ time: 1, price: 2 }] }] } });
    const s2 = await get();
    expect(s2.watchlist).toEqual(["binance:BTCUSDT"]); // untouched
    expect(s2.alerts).toHaveLength(1);
    expect(s2.drawings["binance:BTCUSDT"]).toHaveLength(1);
    expect(await getStore().markets_state.all()).toHaveLength(1);
  });

  it("refuses unknown fields, junk and oversized bodies", async () => {
    await signIn("ann@example.com");
    expect((await put({ password: "x" })).status).toBe(400);
    expect((await put("not json")).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await put({ watchlist: ["x".repeat(500_000)] })).status).toBe(413);
  });

  it("keeps each user's page to themselves", async () => {
    await signIn("ann@example.com");
    await put({ watchlist: ["deriv:R_100"] });
    await signIn("bob@example.com");
    expect((await get()).watchlist).toBeNull();
    await put({ watchlist: ["binance:ETHUSDT"] });
    const rows = await getStore().markets_state.all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.watchlist)).toEqual(expect.arrayContaining([["deriv:R_100"], ["binance:ETHUSDT"]]));
  });
});
