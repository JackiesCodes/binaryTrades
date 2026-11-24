import { describe, expect, it } from "vitest";

import { hoursLabel, inTradingHours, localClock, sanitizeHours, type TradingHours } from "@/lib/trading/hours";
import { byTimeOfDay, type ClosedTrade } from "@/lib/trading/performance";

const at = (iso: string) => new Date(iso);
const WEEK = [1, 2, 3, 4, 5];

describe("trading hours", () => {
  const day: TradingHours = { from: 8, to: 20, days: WEEK, tz: "Africa/Johannesburg" }; // UTC+2

  it("reads the clock in the user's own time zone", () => {
    expect(localClock(at("2026-11-24T05:59:00Z"), "Africa/Johannesburg")).toEqual({ day: 2, hour: 7 + 59 / 60 });
    expect(localClock(at("2026-11-24T05:59:00Z"), "Nowhere/Land").day).toBe(2); // unknown zone: UTC
  });

  it("opens at `from`, stops at `to`, only on the chosen days", () => {
    expect(inTradingHours(day, at("2026-11-24T05:59:00Z"))).toBe(false); // Tue 07:59 local
    expect(inTradingHours(day, at("2026-11-24T06:00:00Z"))).toBe(true); // Tue 08:00
    expect(inTradingHours(day, at("2026-11-24T17:59:00Z"))).toBe(true); // Tue 19:59
    expect(inTradingHours(day, at("2026-11-24T18:00:00Z"))).toBe(false); // Tue 20:00
    expect(inTradingHours(day, at("2026-11-28T10:00:00Z"))).toBe(false); // Saturday
    expect(inTradingHours(null, at("2026-11-28T10:00:00Z"))).toBe(true); // no hours set
  });

  it("overnight windows and all-day", () => {
    const night: TradingHours = { from: 22, to: 6, days: [0, 1, 2, 3, 4, 5, 6], tz: "UTC" };
    expect(inTradingHours(night, at("2026-11-24T23:30:00Z"))).toBe(true);
    expect(inTradingHours(night, at("2026-11-24T05:30:00Z"))).toBe(true);
    expect(inTradingHours(night, at("2026-11-24T12:00:00Z"))).toBe(false);
    expect(inTradingHours({ ...night, from: 0, to: 0 }, at("2026-11-24T12:00:00Z"))).toBe(true);
  });

  it("labels and input repair", () => {
    expect(hoursLabel(day)).toBe("Mon–Fri 08:00–20:00");
    expect(hoursLabel({ from: 22, to: 6, days: [0, 1, 2, 3, 4, 5, 6], tz: "UTC" })).toBe("every day 22:00–06:00");
    expect(hoursLabel({ from: 0, to: 0, days: [1, 3], tz: "UTC" })).toBe("Mon, Wed all day");
    expect(sanitizeHours({ from: 8, to: 24, days: [5, 1, 1, 9], tz: "UTC" })).toEqual({ from: 8, to: 0, days: [1, 5], tz: "UTC" });
    expect(sanitizeHours({ from: 8, to: 20, days: [], tz: "UTC" })).toBeNull();
    expect(sanitizeHours({ from: 8.5, to: 20, days: [1], tz: "UTC" })).toBeNull();
    expect(sanitizeHours({ from: 8, to: 20, days: [1], tz: "Mars/Base" })).toBeNull();
    expect(sanitizeHours("8-20")).toBeNull();
  });
});

describe("results by time of day", () => {
  const trade = (opened: string, pnl: number): ClosedTrade => ({ side: "buy", pnl, risk_amount: 10, opened_at: opened, closed_at: opened });

  it("buckets by the hour and weekday the trade opened, on the user's clock", () => {
    const { hours, days } = byTimeOfDay(
      [trade("2026-11-24T06:10:00Z", 5), trade("2026-11-24T06:50:00Z", -2), trade("2026-11-24T22:30:00Z", -7)],
      "Africa/Johannesburg",
    );
    expect(hours[8]).toEqual({ trades: 2, pnl: 3, wins: 1 }); // 08:xx local
    expect(hours[0]).toEqual({ trades: 1, pnl: -7, wins: 0 }); // 00:30 on Wednesday local
    expect(days[2]).toEqual({ trades: 2, pnl: 3, wins: 1 }); // Tuesday
    expect(days[3]).toEqual({ trades: 1, pnl: -7, wins: 0 }); // Wednesday
  });
});
