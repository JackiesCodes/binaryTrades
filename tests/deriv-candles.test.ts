import { describe, expect, it } from "vitest";

import { pageCandles, type Candle } from "@/lib/brokers/deriv";

const M15 = 900;
const NOW = Date.UTC(2026, 10, 23, 8, 0) / 1000; // Monday 08:00 UTC
const CLOSED_FROM = Date.UTC(2026, 10, 21, 21, 0) / 1000; // gold closes Friday 21:00…
const CLOSED_TO = Date.UTC(2026, 10, 23, 23, 0) / 1000 - 2 * 86400; // …and reopens Sunday 23:00

/** Deriv as it really answers: `count` covers count × granularity of time, closed hours come back empty. */
function deriv(firstEpoch = NOW - 60 * 86400) {
  const calls: Array<number | "latest"> = [];
  const fetchPage = async (end: number | "latest", count: number): Promise<Candle[]> => {
    calls.push(end);
    const to = end === "latest" ? NOW : Math.floor(end / M15) * M15;
    const out: Candle[] = [];
    for (let t = to - (count - 1) * M15; t <= to; t += M15) {
      if (t < firstEpoch || (t >= CLOSED_FROM && t < CLOSED_TO)) continue;
      out.push({ epoch: t, open: 1, high: 1, low: 1, close: 1 });
    }
    return out;
  };
  return { fetchPage, calls };
}

describe("candle history across a closed market", () => {
  it("keeps paging past the weekend until it has what was asked for", async () => {
    const { fetchPage, calls } = deriv();
    const candles = await pageCandles(400, fetchPage);
    expect(candles).toHaveLength(400); // used to stop at ~190 on a Monday: "not enough data"
    expect(candles.at(-1)!.epoch).toBe(NOW);
    expect(calls.length).toBeGreaterThan(1);
    for (let i = 1; i < candles.length; i++) expect(candles[i]!.epoch).toBeGreaterThan(candles[i - 1]!.epoch);
    expect(candles.some((c) => c.epoch >= CLOSED_FROM && c.epoch < CLOSED_TO)).toBe(false);
  });

  it("stops when the history runs out, and never loops for ever", async () => {
    const young = deriv(NOW - 50 * M15); // only 51 candles exist
    expect(await pageCandles(400, young.fetchPage)).toHaveLength(51);
    const empty = deriv(NOW + M15);
    expect(await pageCandles(400, empty.fetchPage)).toEqual([]);
    expect(empty.calls).toHaveLength(1);

    let calls = 0;
    const stuck = async () => {
      calls++;
      return [{ epoch: 1_000_000 - calls * 60, open: 1, high: 1, low: 1, close: 1 }]; // one candle per page, forever
    };
    expect((await pageCandles(400, stuck)).length).toBeLessThanOrEqual(12);
    expect(calls).toBe(12);
  });
});
