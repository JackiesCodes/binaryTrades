import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { GET } from "@/app/api/bots/[id]/preview/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { botMarks, botNowText, timeframeForBot, type BotPreview } from "@/lib/markets/bot-view";
import { SCRIPT_TEMPLATES } from "@/lib/strategies/script-templates";
import { clearCandleCache, deps } from "@/lib/trading/engine";
import { getStore, resetStore } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

const code = SCRIPT_TEMPLATES.find((t) => t.id === "two_candle_momentum")!.code;
const M15 = 900;

// 60 quiet candles, a BUY setup that reaches its target, quiet again, then a SELL setup still open.
function candles(count: number) {
  const now = Math.floor(Date.now() / 1000 / M15) * M15;
  const out = Array.from({ length: count }, (_, i) => ({ epoch: now - (count - i) * M15, open: 100, high: 100.1, low: 99.9, close: 100 }));
  const set = (k: number, o: number, c: number, hi?: number, lo?: number) => (out[k] = { ...out[k]!, open: o, close: c, high: hi ?? Math.max(o, c) + 0.1, low: lo ?? Math.min(o, c) - 0.1 });
  const n = count;
  set(n - 12, 100, 100.5);
  set(n - 11, 100.5, 101.5); // BUY at the next open: stop 100.5, target 104 (stop 1, × 2.5)
  set(n - 10, 101.5, 101.5, 104.2, 101.4); // target hit
  for (let k = n - 9; k < n - 2; k++) set(k, 101.5, 101.5);
  set(n - 2, 101.5, 101.0);
  set(n - 1, 101.0, 99.9); // SELL at the next open, still open at the end
  return out;
}

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-preview-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
  clearCandleCache();
  deps.candles = async (_s, _g, count) => [...candles(count), { epoch: Math.floor(Date.now() / 1000 / M15) * M15, open: 99.9, high: 99.9, low: 99.9, close: 99.9 }];
});

const bot = (over: Partial<Bot> = {}): Bot =>
  ({
    id: "b1", user_id: "", name: "Two pre", source: "builtin", broker_account_id: null, symbol: "frxXAUUSD", data_symbol: "frxXAUUSD", price_source: "deriv",
    timeframe: M15, strategy: { id: "script", params: { stop_distance: 1, reward_ratio: 2.5, atr_mult: 2, rr: 0 }, code }, status: "running", paused_reason: null,
    risk_percent: 1, risk_amount: 20, deriv_multiplier: 100, magic: 1, webhook_passphrase: "x", last_bar_epoch: null, last_signal_at: null, created_at: "2026-11-28T00:00:00Z",
    ...over,
  }) as Bot;

describe("/api/bots/:id/preview", () => {
  it("runs the bot's strategy over its market: trades with stop and target, and what it holds now", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await getStore().bots.insert(bot({ user_id: ann.id }));
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const res = await GET(new Request("http://localhost/api/bots/b1/preview"), { params: { id: "b1" } });
    expect(res.status).toBe(200);
    const p = (await res.json()) as BotPreview;
    expect(p.bot).toMatchObject({ id: "b1", name: "Two pre", timeframe: M15 });
    expect(p.trades).toHaveLength(2);
    const [buy, sell] = p.trades;
    expect(buy).toMatchObject({ side: "buy", reason: "target", stop: 100.5, target: 104 });
    expect(buy!.pnl).toBeCloseTo(50, 0); // Fixed $20 risk × 2.5 (less costs)
    expect(sell).toMatchObject({ side: "sell", reason: "end", stop: 100.9, target: 97.4 });
    expect(p.open).toMatchObject({ side: "sell" });
    expect(botNowText(p, (n) => n.toFixed(2))).toMatch(/^in a SELL since .* · stop 100\.90 · target 97\.40$/);
  });

  it("Deriv: a stop further than price ÷ multiplier closes there (the stake runs out), with a warning", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await getStore().brokers.insert({ id: "d1", user_id: ann.id, kind: "deriv", label: "Deriv demo", is_demo: true, equity: 10_000, balance: 10_000, currency: "USD", status: "connected" } as never);
    // Gold allows ×100: price ~100 ÷ 100 = 1 point at most, but the bot's stop is 3 away.
    await getStore().bots.insert(bot({ user_id: ann.id, broker_account_id: "d1", deriv_multiplier: 100, strategy: { id: "script", params: { stop_distance: 3, reward_ratio: 2.5, atr_mult: 2, rr: 0 }, code } }));
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const p = (await (await GET(new Request("http://localhost/x"), { params: { id: "b1" } })).json()) as BotPreview;
    const buy = p.trades[0]!;
    expect(buy.side).toBe("buy");
    expect(buy.entry - buy.stop).toBeCloseTo(buy.entry / 100, 6); // closes 1 away, not 3
    expect(buy.target! - buy.entry).toBeCloseTo(7.5, 6); // the target is unchanged
    expect(p.warning).toMatch(/at ×100, a trade can't lose more than its stake, so it closes about 1\.00 away, before its 3 stop .* set stop_distance to 0\.79 or less/);
  });

  it("no warning when the stop fits", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await getStore().brokers.insert({ id: "d1", user_id: ann.id, kind: "deriv", label: "Deriv demo", is_demo: true, equity: 10_000, balance: 10_000, currency: "USD", status: "connected" } as never);
    await getStore().bots.insert(bot({ user_id: ann.id, broker_account_id: "d1", deriv_multiplier: 100, strategy: { id: "script", params: { stop_distance: 0.5, reward_ratio: 2.5, atr_mult: 2, rr: 0 }, code } }));
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const p = (await (await GET(new Request("http://localhost/x"), { params: { id: "b1" } })).json()) as BotPreview;
    expect(p.warning).toBeNull();
  });

  it("respects the bot's trading hours", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    const h = new Date().getUTCHours();
    // Closed for the hours around now: the recent setups aren't taken.
    await getStore().bots.insert(bot({ user_id: ann.id, trading_hours: { from: (h + 6) % 24, to: (h + 8) % 24, days: [0, 1, 2, 3, 4, 5, 6], tz: "UTC" } }));
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const p = (await (await GET(new Request("http://localhost/api/bots/b1/preview"), { params: { id: "b1" } })).json()) as BotPreview;
    expect(p.trades).toHaveLength(0);
    expect(p.open).toBeNull();
  });

  it("only for the bot's owner; TradingView bots have no strategy to draw", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    const bob = await createUser({ email: "bob@example.com", password: "a long password" });
    await getStore().bots.insert(bot({ user_id: ann.id }));
    await getStore().bots.insert(bot({ id: "tv", user_id: ann.id, source: "tradingview", strategy: null }));
    cookie = (await createSessionToken(bob.id, bob.session_version)).value;
    expect((await GET(new Request("http://localhost/x"), { params: { id: "b1" } })).status).toBe(404);
    cookie = (await createSessionToken(ann.id, ann.session_version)).value;
    const tv = await GET(new Request("http://localhost/x"), { params: { id: "tv" } });
    expect(tv.status).toBe(422);
    expect((await tv.json()).details).toMatch(/TradingView alerts/);
  });
});

describe("bot marks on the chart", () => {
  it("an arrow where each trade opened, its result where it closed, nothing yet for an open one", () => {
    const t = (o: Partial<BotPreview["trades"][0]>) => ({ side: "buy" as const, entry_epoch: 0, exit_epoch: 0, entry: 1, exit: 1, pnl: 0, r_multiple: 0, reason: "target" as const, stop: 0.9, target: 1.2, ...o });
    const marks = botMarks([t({ entry_epoch: 1000, exit_epoch: 3700, pnl: 50 }), t({ side: "sell", entry_epoch: 7300, exit_epoch: 9000, reason: "end", pnl: -3 })], 900, new Set([900, 3600, 7200, 8100]));
    expect(marks).toEqual([
      { time: 900, kind: "open", side: "buy", text: "Bot buy" },
      { time: 3600, kind: "close", side: "buy", text: "+50.00", won: true },
      { time: 7200, kind: "open", side: "sell", text: "Bot sell" },
    ]);
    expect([timeframeForBot(900), timeframeForBot(3600), timeframeForBot(120)]).toEqual(["15m", "1h", null]);
  });
});
