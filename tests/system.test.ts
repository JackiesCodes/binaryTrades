import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

import { POST as createBot } from "@/app/api/bots/route";
import { PATCH as updateBot } from "@/app/api/bots/[id]/route";
import { GET as botPerformance } from "@/app/api/bots/[id]/performance/route";
import { GET as botPreview } from "@/app/api/bots/[id]/preview/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import type { BotPreview } from "@/lib/markets/bot-view";
import { summaryText } from "@/lib/push-summary";
import { encryptSecret } from "@/lib/secrets";
import { SCRIPT_TEMPLATES } from "@/lib/strategies/script-templates";
import { activeTrades, clearCandleCache, deps, runEngineTick } from "@/lib/trading/engine";
import { performance, type ClosedTrade } from "@/lib/trading/performance";
import { getStore, newId, nowIso, resetStore } from "@/lib/trading/store";
import type { Bot, BrokerAccount } from "@/lib/trading/types";

/**
 * One user's whole journey through the real engine, API routes and figures, to check that the
 * features agree with each other: a script bot created with Fixed $ risk, Protect profits and
 * trading hours; the engine opening, trailing and closing its trade on Deriv; and the logs,
 * performance figures, daily summary and Bot on chart preview all telling the same story.
 */

const M15 = 900;
const code = SCRIPT_TEMPLATES.find((t) => t.id === "two_candle_momentum")!.code;

// ---------------------------------------------------------------------------
// A fake market and a fake Deriv account, driven by `price`.

let price = 100;
/** The newest closed candle, by epoch; the scenario moves time on by changing this. */
let lastClosed = 0;
type Contract = { id: string; side: "buy" | "sell"; stake: number; entry: number; mult: number; stopLoss: number | null; sold: boolean; profit: number };
let contracts: Contract[] = [];
const profitOf = (c: Contract, at: number) => ((at - c.entry) / c.entry) * c.mult * c.stake * (c.side === "buy" ? 1 : -1);

function feed(count: number) {
  // Quiet dojis at 100, then two bullish candles with the newer body bigger: a BUY setup.
  const out = Array.from({ length: count }, (_, i) => ({ epoch: lastClosed - (count - 1 - i) * M15, open: 100, high: 100.02, low: 99.98, close: 100 }));
  out[count - 2] = { ...out[count - 2]!, open: 100, close: 100.1, high: 100.11, low: 99.99 };
  out[count - 1] = { ...out[count - 1]!, open: 100.1, close: 100.3, high: 100.31, low: 100.09 };
  // ...plus the candle forming now (dropped by the engine, which only reads closed ones).
  return [...out, { epoch: lastClosed + M15, open: price, high: price, low: price, close: price }];
}

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-system-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.CRON_SECRET;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  resetStore();
  clearCandleCache();
  price = 100.3;
  lastClosed = Math.floor(Date.now() / 1000 / M15) * M15 - M15;
  contracts = [];
  deps.candles = async (_s, _g, count) => feed(count);
  deps.derivOpen = async (_cred, order) => {
    const c: Contract = {
      id: `c${contracts.length + 1}`, side: order.side, stake: order.stake, entry: price, mult: order.multiplier,
      stopLoss: order.stopLossAmount ?? null, sold: false, profit: 0,
    };
    contracts.push(c);
    return { contract_id: c.id, buy_price: c.stake, entry_spot: price };
  };
  deps.derivClose = async (_cred, id) => {
    const c = contracts.find((x) => x.id === id)!;
    c.sold = true;
    c.profit = profitOf(c, price);
    return { sold_for: c.stake + c.profit, profit: c.profit, exit_spot: price, commission: null };
  };
  deps.derivSnapshot = async (_cred, tracked) => ({
    balance: 1000,
    currency: "USD",
    equity: 1000,
    contracts: contracts
      .filter((c) => tracked.includes(c.id))
      .map((c) => ({
        contract_id: c.id, symbol: "frxXAUUSD", side: c.side, stake: c.stake, profit: c.sold ? c.profit : profitOf(c, price),
        entry_spot: c.entry, current_spot: price, is_sold: c.sold, sell_price: null, exit_spot: c.sold ? price : null, commission: null,
      })),
  });
  deps.checkPriceAlerts = async () => ({ waiting: 0, fired: 0 });
});

const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("binaryTrades as one system", () => {
  it("script bot with Fixed $20, Protect profits and trading hours: open → trail → close → figures → preview", async () => {
    // 1. A new user with a Deriv demo account.
    const user = await createUser({ email: "sam@example.com", password: "a long password" });
    cookie = (await createSessionToken(user.id, user.session_version)).value;
    const broker: BrokerAccount = {
      id: newId(), user_id: user.id, kind: "deriv", label: "Deriv demo", status: "connected", login: "VRTC1", server: null, currency: "USD",
      balance: 1000, equity: 1000, is_demo: true, encrypted_token: encryptSecret("demo-token"), app_id: "12345", bridge_key_hash: null,
      last_sync_at: nowIso(), error: null, created_at: nowIso(),
    };
    await getStore().brokers.insert(broker);

    // 2. Created from the Scripts page: the template, $20 per trade, protect profits at +1R / 1R.
    const res = await createBot(
      json({
        name: "Gold momentum", source: "builtin", strategy_id: "script", script: code, broker_account_id: broker.id,
        symbol: "frxXAUUSD", data_symbol: "frxXAUUSD", timeframe: M15, risk_amount: 20,
        strategy_params: { direction: 0, stop_distance: 0.4, reward_ratio: 2.5, atr_mult: 2, rr: 2 },
        trail: { start_r: 1, distance_r: 1 }, start: true,
      }),
      {} as never,
    );
    expect(res.status).toBe(201);
    const bot = (await res.json()) as Bot;
    expect(bot).toMatchObject({ status: "running", risk_amount: 20, trail: { start_r: 1, distance_r: 1 } });

    // 3. Trading hours from the bot page: every day, all day, in the user's zone.
    const patched = await updateBot(
      new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trading_hours: { from: 0, to: 0, days: [0, 1, 2, 3, 4, 5, 6], tz: "Africa/Johannesburg" } }) }),
      { params: { id: bot.id } },
    );
    expect(patched.status).toBe(200);

    // 4. The cron tick: the setup on the latest closed candle opens one BUY at $20 risk.
    await runEngineTick();
    const [trade] = await activeTrades(user.id, { bot_id: bot.id });
    expect(trade).toMatchObject({ side: "buy", book: "demo", risk_amount: 20 });
    expect(trade!.sl).toBeCloseTo(100.3 - 0.4, 6);
    expect(trade!.tp).toBeCloseTo(100.3 + 1.0, 6);
    // Deriv stake: $20 over a 0.4 stop at the multiplier → the stop loses exactly $20.
    const c = contracts[0]!;
    expect(c.stopLoss).toBeCloseTo(20, 1);
    expect(profitOf(c, 100.3 - 0.4)).toBeCloseTo(-20, 1);

    // 5. Same candle again (next minute): one trade at a time, nothing new.
    await runEngineTick();
    expect(contracts).toHaveLength(1);

    // 6. The price runs to +1.5 R: the stop moves to break-even and beyond (best 100.9 − 0.4 = 100.5).
    price = 100.9;
    await runEngineTick();
    const moved = (await getStore().trades.get(trade!.id))!;
    expect(moved.best_price).toBeCloseTo(100.9, 6);
    expect(moved.trail_stop).toBeCloseTo(100.5, 6);

    // 7. It comes back through the trailing stop: closed in profit, by binaryTrades, on Deriv.
    price = 100.45;
    await runEngineTick();
    const closed = (await getStore().trades.get(trade!.id))!;
    expect(closed.status).toBe("closed");
    expect(closed.close_reason).toMatch(/^Trailing stop/);
    expect(closed.pnl).toBeGreaterThan(0);
    expect(c.sold).toBe(true);
    expect(await activeTrades(user.id, { bot_id: bot.id })).toHaveLength(0);
    // ...and the bot doesn't jump back into the same old setup.
    await runEngineTick();
    expect(contracts).toHaveLength(1);
    const after = (await getStore().bots.get(bot.id))!;
    expect(after.status).toBe("running");

    // 8. The activity log tells the story in order, with no errors.
    const logs = (await getStore().logs.all()).filter((l) => l.user_id === user.id);
    const text = logs.map((l) => l.message).join("\n");
    expect(text).toMatch(/Protect profits|trading hours/i);
    expect(text).toMatch(/now follows the price/);
    expect(logs.filter((l) => l.level === "error")).toEqual([]);

    // 9. Performance figures and the evening summary agree with the trade.
    const perfRes = await botPerformance(new Request("http://localhost/x"), { params: { id: bot.id } });
    const { trades: rows } = (await perfRes.json()) as { trades: ClosedTrade[] };
    expect(rows).toHaveLength(1);
    const perf = performance(rows);
    expect(perf.trades).toBe(1);
    expect(perf).toMatchObject({ wins: 1, losses: 0, winRate: 100 });
    expect(perf.net).toBeCloseTo(closed.pnl, 6);
    expect(summaryText([closed], [], () => "USD")).toMatch(/^Demo: 1 trade closed, 1 won, \+/);

    // 10. Bot on chart: the same strategy and settings over the same candles show the trade it's in.
    const p = (await (await botPreview(new Request("http://localhost/x"), { params: { id: bot.id } })).json()) as BotPreview;
    expect(p.warning).toBeNull();
    // (The preview reads closed candles, so the moves inside the forming candle above aren't in it yet.)
    expect(p.trades.at(-1)).toMatchObject({ side: "buy", reason: "end", entry: 100.3 });
    expect(p.trades.at(-1)!.stop).toBeCloseTo(99.9, 6);
    expect(p.trades.at(-1)!.target).toBeCloseTo(101.3, 6);
  });
});
