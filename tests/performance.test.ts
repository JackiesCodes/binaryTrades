import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { GET } from "@/app/api/bots/[id]/performance/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { holdLabel, performance, type ClosedTrade } from "@/lib/trading/performance";
import { getStore, newId, resetStore } from "@/lib/trading/store";
import type { Bot, Trade } from "@/lib/trading/types";

const T0 = Date.UTC(2026, 10, 2, 8);
let n = 0;
/** A closed trade, `hold` minutes long, closing an hour after the previous one. */
const t = (pnl: number, side: "buy" | "sell" = "buy", risk = 10, hold = 30): ClosedTrade => {
  const closed = T0 + ++n * 3_600_000;
  return { side, pnl, risk_amount: risk, opened_at: new Date(closed - hold * 60_000).toISOString(), closed_at: new Date(closed).toISOString() };
};

describe("bot performance figures", () => {
  beforeEach(() => (n = 0));

  it("profit factor, expectancy, averages and the split by side", () => {
    const p = performance([t(20), t(-10, "sell"), t(15), t(-5, "sell"), t(0)]);
    expect(p).toMatchObject({ trades: 5, wins: 2, losses: 2, winRate: 40, net: 20, grossProfit: 35, grossLoss: 15 });
    expect(p.profitFactor).toBe(2.33);
    expect(p.expectancy).toBe(4); // 20 / 5
    expect(p.expectancyR).toBe(0.4); // (2 − 1 + 1.5 − 0.5 + 0) / 5
    expect(p).toMatchObject({ avgWin: 17.5, avgLoss: -7.5, best: 20, worst: -10, avgHoldMin: 30 });
    expect(p.buys).toEqual({ trades: 3, winRate: 67, pnl: 35 });
    expect(p.sells).toEqual({ trades: 2, winRate: 0, pnl: -15 });
    expect(p.curve).toEqual([20, 10, 25, 20, 20]);
  });

  it("drawdown is the deepest fall from a high, also when it's still below it", () => {
    const p = performance([t(10), t(-4), t(-8), t(5), t(30), t(-6)]);
    expect(p.maxDrawdown).toBe(12); // 10 → −2
    expect(p.drawdownNow).toBe(6); // 33 high → 27
    const fromStart = performance([t(-5), t(-5), t(3)]);
    expect(fromStart.maxDrawdown).toBe(10); // losing from the first trade counts from 0
  });

  it("streaks, in time order whatever order the trades come in", () => {
    const trades = [t(1), t(2), t(3), t(-1), t(-1), t(5), t(-2), t(-3)];
    const p = performance([...trades].reverse());
    expect(p).toMatchObject({ longestWinStreak: 3, longestLossStreak: 2, streakNow: -2 });
    expect(performance([t(-1), t(4)]).streakNow).toBe(1);
  });

  it("edge cases: nothing yet, only wins, no risk figure", () => {
    expect(performance([])).toMatchObject({ trades: 0, winRate: null, profitFactor: null, expectancy: null, avgHoldMin: null, best: null, maxDrawdown: 0 });
    expect(performance([t(5), t(6)]).profitFactor).toBe(Infinity);
    expect(performance([t(5, "buy", 0)]).expectancyR).toBeNull();
    expect([holdLabel(45), holdLabel(200), holdLabel(120), holdLabel(4000)]).toEqual(["45 min", "3 h 20 min", "2 h", "3 days"]);
  });
});

describe("/api/bots/:id/performance", () => {
  beforeEach(() => {
    process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-perf-")), "store.json");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SESSION_SECRET = "test-session-secret-0123456789";
    resetStore();
  });

  it("returns the owner's closed trades for the bot, and nothing for anyone else", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    const bob = await createUser({ email: "bob@example.com", password: "a long password" });
    const store = getStore();
    await store.bots.insert({ id: "bot-1", user_id: ann.id, name: "Two pre" } as Bot);
    const trade = (over: Partial<Trade>) =>
      store.trades.insert({ id: newId(), user_id: ann.id, bot_id: "bot-1", side: "buy", pnl: 1, risk_amount: 10, status: "closed", opened_at: "2026-11-02T08:00:00Z", closed_at: "2026-11-02T09:00:00Z", ...over } as Trade);
    await trade({ pnl: 12.5 });
    await trade({ pnl: -4, side: "sell" });
    await trade({ status: "open", closed_at: null }); // still open: not counted
    await trade({ bot_id: "other-bot" }); // another bot's

    const ctx = { params: { id: "bot-1" } };
    const req = new Request("http://localhost/api/bots/bot-1/performance");
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const body = await (await GET(req, ctx)).json();
    expect(body.capped).toBe(false);
    expect(body.trades.map((x: ClosedTrade) => x.pnl).sort()).toEqual([-4, 12.5]);
    expect(Object.keys(body.trades[0]).sort()).toEqual(["closed_at", "opened_at", "pnl", "risk_amount", "side"]);

    cookie = (await createSessionToken(bob.id, bob.session_version)).value;
    expect((await GET(req, ctx)).status).toBe(404);
    cookie = undefined;
    expect((await GET(req, ctx)).status).toBe(401);
  });
});
