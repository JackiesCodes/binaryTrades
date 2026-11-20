import { describe, expect, it } from "vitest";

import { advanceBookState, checkRisk, derivStake } from "@/lib/trading/risk";
import { defaultSettings } from "@/lib/trading/store";
import type { Bot } from "@/lib/trading/types";

const bot = { status: "running", risk_percent: 1 } as Bot;
const base = {
  settings: defaultSettings("u"),
  book: "real" as const,
  bot,
  equity: 10_000,
  bookEquity: 10_000,
  bookState: { peak_equity: 10_000, day_key: "2026-01-01", day_start_equity: 10_000 },
  openTradesInBook: 0,
  openTradesForBot: 0,
};

describe("checkRisk", () => {
  it("sizes risk from equity", () => {
    expect(checkRisk(base)).toEqual({ ok: true, riskAmount: 100 });
  });

  it("sizes from the account but checks limits on the whole book", () => {
    expect(checkRisk({ ...base, equity: 2_000 })).toEqual({ ok: true, riskAmount: 20 });
    expect(checkRisk({ ...base, equity: 2_000, bookEquity: 9_700 })).toMatchObject({ ok: false, breach: "daily_loss" });
  });

  it("risks a fixed amount when the bot sets one, still capped at 5% of the account", () => {
    expect(checkRisk({ ...base, bot: { ...bot, risk_amount: 25 } })).toEqual({ ok: true, riskAmount: 25 });
    // 5% of 300 is 15, so a $25 fixed risk is cut to $15 on a small account.
    expect(checkRisk({ ...base, equity: 300, bot: { ...bot, risk_amount: 25 } })).toEqual({ ok: true, riskAmount: 15 });
    expect(checkRisk({ ...base, bot: { ...bot, risk_amount: null } })).toEqual({ ok: true, riskAmount: 100 });
  });

  it("caps per-trade risk at 5%", () => {
    expect(checkRisk({ ...base, bot: { ...bot, risk_percent: 20 } })).toEqual({ ok: true, riskAmount: 500 });
  });

  it("blocks on kill switch, daily loss, drawdown and trade limits", () => {
    expect(checkRisk({ ...base, settings: { ...defaultSettings("u"), kill_switch: true } }).ok).toBe(false);
    expect(checkRisk({ ...base, bookEquity: 9_700 })).toMatchObject({ ok: false, breach: "daily_loss" });
    expect(
      checkRisk({ ...base, bookEquity: 8_400, bookState: { ...base.bookState, day_start_equity: 8_400 } }),
    ).toMatchObject({ ok: false, breach: "drawdown" });
    expect(checkRisk({ ...base, openTradesInBook: 8 }).ok).toBe(false);
    expect(checkRisk({ ...base, openTradesForBot: 1 }).ok).toBe(false);
  });
});

describe("challenge risk", () => {
  const challenge = { risk_percent: 40, target_multiple: 2, hours: 24, started_at: "", start_equity: 10_000, ended_at: null, result: null, end_equity: null };

  it("uses the challenge's risk on demo, and skips the demo loss limits", () => {
    const demo = { ...base, book: "demo" as const, bot: { ...bot, challenge } };
    expect(checkRisk(demo)).toEqual({ ok: true, riskAmount: 4000 });
    expect(checkRisk({ ...demo, bookEquity: 5_000 })).toEqual({ ok: true, riskAmount: 4000 });
    expect(checkRisk({ ...demo, bot: { ...bot, challenge: { ...challenge, risk_percent: 90 } } })).toEqual({ ok: true, riskAmount: 5000 });
  });

  it("never applies to real money", () => {
    const real = { ...base, book: "real" as const, bot: { ...bot, challenge } };
    expect(checkRisk(real)).toEqual({ ok: true, riskAmount: 100 });
    expect(checkRisk({ ...real, bookEquity: 9_700 })).toMatchObject({ ok: false, breach: "daily_loss" });
  });

  it("stops at the kill switch like everything else", () => {
    const demo = { ...base, book: "demo" as const, bot: { ...bot, challenge }, settings: { ...defaultSettings("u"), kill_switch: true } };
    expect(checkRisk(demo).ok).toBe(false);
  });

  it("ignores a finished challenge", () => {
    const demo = { ...base, book: "demo" as const, bot: { ...bot, challenge: { ...challenge, ended_at: "x", result: "won" as const } } };
    expect(checkRisk(demo)).toEqual({ ok: true, riskAmount: 100 });
  });
});

describe("advanceBookState", () => {
  it("rolls the day and tracks the peak", () => {
    const s = advanceBookState({ peak_equity: 100, day_key: "a", day_start_equity: 100 }, 120, "b");
    expect(s).toEqual({ peak_equity: 120, day_key: "b", day_start_equity: 120 });
  });
});

describe("derivStake", () => {
  it("loses ≈ the risk amount at the stop", () => {
    const { stake, stopLossAmount } = derivStake({ riskAmount: 10, entry: 1.1, stopDistance: 0.0055, multiplier: 100, equity: 1000 });
    expect(stake * 100 * (0.0055 / 1.1)).toBeCloseTo(10);
    expect(stopLossAmount).toBe(10);
  });

  it("never stakes more than a quarter of equity", () => {
    expect(derivStake({ riskAmount: 10, entry: 1.1, stopDistance: 0.00001, multiplier: 100, equity: 1000 }).stake).toBe(250);
  });

  it("lets a demo challenge stake up to the whole account", () => {
    expect(derivStake({ riskAmount: 10, entry: 1.1, stopDistance: 0.00001, multiplier: 100, equity: 1000, maxStakeFraction: 1 }).stake).toBe(1000);
  });
});
