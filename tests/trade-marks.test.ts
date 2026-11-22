import { describe, expect, it } from "vitest";

import { tradeLines, tradeMarks, tradesForMarket } from "@/lib/markets/trade-marks";
import type { Trade } from "@/lib/trading/types";

const T = (patch: Partial<Trade>): Trade =>
  ({
    id: "t", user_id: "u", bot_id: null, broker_account_id: null, book: "demo", symbol: "frxXAUUSD", data_symbol: "frxXAUUSD", side: "buy",
    size: 10, size_unit: "stake", entry_price: 3500, current_price: 3510, sl: 3480, tp: 3540, risk_amount: 10, pnl: 2.5, status: "open",
    broker_ref: null, magic: null, external: false, close_reason: null, exit_price: null, opened_at: "2026-11-20T10:07:00Z", closed_at: null,
    ...patch,
  }) as Trade;
const at = (iso: string) => Date.parse(iso) / 1000;

describe("trades on the Markets chart", () => {
  it("keeps this market's trades for the chosen account type, without rejected orders", () => {
    const list = [T({ id: "a" }), T({ id: "b", book: "real" }), T({ id: "c", data_symbol: "R_100" }), T({ id: "d", status: "rejected" })];
    expect(tradesForMarket(list, "frxXAUUSD", "demo").map((t) => t.id)).toEqual(["a"]);
  });

  it("puts an arrow on the candle a trade opened in and its result where it closed, in time order", () => {
    const bars = new Set([at("2026-11-20T10:00:00Z"), at("2026-11-20T11:00:00Z"), at("2026-11-20T12:00:00Z")]);
    const marks = tradeMarks(
      [
        T({ id: "late", side: "sell", opened_at: "2026-11-20T12:30:00Z" }),
        T({ id: "won", status: "closed", opened_at: "2026-11-20T10:07:00Z", closed_at: "2026-11-20T11:59:00Z", pnl: 12.345 }),
        T({ id: "old", opened_at: "2026-11-19T10:00:00Z" }), // before the chart's first candle: not drawn
      ],
      3600,
      bars,
    );
    expect(marks).toEqual([
      { time: at("2026-11-20T10:00:00Z"), kind: "open", side: "buy", text: "Buy" },
      { time: at("2026-11-20T11:00:00Z"), kind: "close", side: "buy", text: "+12.35", won: true },
      { time: at("2026-11-20T12:00:00Z"), kind: "open", side: "sell", text: "Sell" },
    ]);
  });

  it("draws entry, stop and target lines for open trades only", () => {
    expect(tradeLines([T({ id: "x" }), T({ id: "y", status: "closed" }), T({ id: "z", sl: null, tp: null, pnl: -1 })])).toEqual([
      { id: "x:entry", price: 3500, kind: "entry", title: "Buy +2.50" },
      { id: "x:stop", price: 3480, kind: "stop", title: "Stop" },
      { id: "x:target", price: 3540, kind: "target", title: "Target" },
      { id: "z:entry", price: 3500, kind: "entry", title: "Buy -1.00" },
    ]);
  });
});
