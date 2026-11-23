import { describe, expect, it } from "vitest";

import { messageForLog } from "@/lib/push";
import { STUCK_AFTER_MS, isStuck, watchdog, type CheckState } from "@/lib/trading/watchdog";

const T0 = Date.UTC(2026, 10, 23, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** Run the watchdog through a sequence of (minutes after T0, verdict), as the engine would. */
function run(steps: Array<[number, string]>) {
  let prev: CheckState | null = null;
  const said: string[] = [];
  for (const [min, verdict] of steps) {
    const now = T0 + min * 60_000;
    const d = watchdog(prev, verdict, "Two pre", now);
    if (d.warn) said.push(d.warn);
    if (d.recovered) said.push(d.recovered);
    prev = { at: iso(now), result: verdict, stuck_since: d.stuck_since, stuck_warned: d.stuck_warned };
  }
  return { said, prev: prev! };
}

describe("stuck-bot watchdog", () => {
  it("only counts verdicts where the bot couldn't look at the market", () => {
    expect(isStuck("not enough data")).toBe(true);
    expect(isStuck("waiting for MT5 prices")).toBe(true);
    expect(isStuck("waiting for next bar")).toBe(false);
    expect(isStuck("buy refused: Risk Guard: daily loss limit")).toBe(false); // the guard working, not a stuck bot
    expect(isStuck("error: internal server error")).toBe(false); // errors are reported as they happen
  });

  it("warns once after two hours stuck, then says when it recovers", () => {
    const minutes = Array.from({ length: 200 }, (_, i) => [i, "not enough data"] as [number, string]);
    const { said, prev } = run([...minutes, [200, "sell"], [201, "waiting for next bar"]]);
    expect(said).toEqual([
      "Two pre can't trade: not enough price history from the data feed, for 2 h. It's still on and will carry on by itself once this clears.",
      "Two pre is checking the market again",
    ]);
    expect(prev).toMatchObject({ stuck_since: null, stuck_warned: false });
  });

  it("a short blip says nothing, and a stuck spell restarts its clock after recovering", () => {
    expect(run([[0, "not enough data"], [100, "not enough data"], [110, "hold"], [111, "not enough data"], [200, "not enough data"]]).said).toEqual([]);
    expect(STUCK_AFTER_MS).toBe(2 * 3_600_000);
  });

  it("its warning reaches the phone as a problem", () => {
    const { said } = run([[0, "waiting for MT5 prices"], [3 * 24 * 60, "waiting for MT5 prices"]]);
    expect(said[0]).toContain("for 3 days");
    expect(messageForLog("warn", said[0]!)).toMatchObject({ topic: "problems", msg: { title: "Needs your attention" } });
    expect(messageForLog("info", "Two pre is checking the market again")).toBeNull();
  });
});
