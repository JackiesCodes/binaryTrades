// Stop and target suggestions for a trade placed from the Markets chart: the bots' usual rule,
// a stop 2 × ATR(14) away and a target 2 × the stop distance. Pure helpers.

import type { Bar } from "@/lib/markets/bars";
import { atr } from "@/lib/strategies/indicators";
import type { Candle } from "@/lib/strategies/types";

export const STOP_ATR = 2;
export const TARGET_RR = 2;

/** Suggested stop and target for a buy or sell at `entry`, from the chart's candles (null without enough candles). */
export function suggestLevels(bars: Bar[], side: "buy" | "sell", entry: number, atrMult = STOP_ATR, rr = TARGET_RR): { stop: number; target: number } | null {
  if (bars.length < 16 || !(entry > 0)) return null;
  const candles: Candle[] = bars.map((b) => ({ epoch: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
  const a = atr(candles, 14).at(-1);
  if (!a || !Number.isFinite(a) || a <= 0) return null;
  const d = a * atrMult;
  const dir = side === "buy" ? 1 : -1;
  return { stop: entry - dir * d, target: entry + dir * rr * d };
}

/** Why a stop / target can't be used for this order, or null. Either may be left empty. */
export function levelsProblem(side: "buy" | "sell", entry: number | null, stop: number | null, target: number | null): string | null {
  if (stop !== null && !(stop > 0)) return "The stop must be above 0.";
  if (target !== null && !(target > 0)) return "The target must be above 0.";
  if (entry === null) return null;
  if (side === "buy") {
    if (stop !== null && stop >= entry) return "For a buy, the stop goes below the current price.";
    if (target !== null && target <= entry) return "For a buy, the target goes above the current price.";
  } else {
    if (stop !== null && stop <= entry) return "For a sell, the stop goes above the current price.";
    if (target !== null && target >= entry) return "For a sell, the target goes below the current price.";
  }
  return null;
}
