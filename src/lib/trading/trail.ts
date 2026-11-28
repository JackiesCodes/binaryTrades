/**
 * "Protect profits": a stop that follows a winning trade. Distances are in R, the trade's own first
 * stop distance (a 20-point stop: 1 R = 20 points), so one setting suits any market.
 *
 *  - Once the trade has been start_r × R in profit, the stop moves to distance_r × R behind the best
 *    price reached. With start_r = distance_r (e.g. 1 and 1) that first move is exactly break-even.
 *  - It only ever moves towards profit, never back.
 *  - no_target: no take profit, so the trailing stop decides the exit.
 *
 * binaryTrades manages this stop itself (checked every minute, the trade is closed when the price
 * falls back to it); the broker keeps the first stop as a safety net. Deriv can't hold a stop in
 * profit on a multiplier trade, and the MT5 bridge only opens and closes, so this works for both.
 */

export interface TrailConfig {
  /** Start following once the trade is this many R in profit. */
  start_r: number;
  /** Keep the stop this many R behind the best price. */
  distance_r: number;
  /** No take profit: let the trailing stop decide the exit. */
  no_target?: boolean;
}

export interface TrailState {
  /** Best price since entry (highest for a buy, lowest for a sell). */
  best: number;
  /** The trailing stop, once started (null before). */
  stop: number | null;
}

/**
 * One step: the trade's best price so far and its trailing stop, given the latest price range seen
 * (high / low; pass the same price twice for a single price). The stop is computed from the best
 * price *before* this range, so a spike that both sets a new high and falls back counts pessimistically.
 */
export function trailStep(
  t: { side: "buy" | "sell"; entry: number; firstStop: number },
  cfg: TrailConfig,
  prev: TrailState,
  range: { high: number; low: number },
): TrailState & { hit: boolean } {
  const dir = t.side === "buy" ? 1 : -1;
  const r = Math.abs(t.entry - t.firstStop);
  if (!(r > 0)) return { ...prev, hit: false };
  // Did the price come back to the stop we already had?
  const hit = prev.stop !== null && (dir === 1 ? range.low <= prev.stop : range.high >= prev.stop);
  const best = dir === 1 ? Math.max(prev.best, range.high) : Math.min(prev.best, range.low);
  let stop = prev.stop;
  if ((best - t.entry) * dir >= cfg.start_r * r) {
    const next = best - dir * cfg.distance_r * r;
    if (stop === null || (next - stop) * dir > 0) stop = next;
  }
  return { best, stop, hit };
}

/** Repaired settings from untrusted input, or null when unusable. */
export function sanitizeTrail(value: unknown): TrailConfig | null {
  const v = value as Partial<TrailConfig> | null;
  if (!v || typeof v !== "object") return null;
  const start = Number(v.start_r);
  const dist = Number(v.distance_r);
  if (!Number.isFinite(start) || start < 0.1 || start > 20 || !Number.isFinite(dist) || dist < 0.1 || dist > 20) return null;
  // Starting closer than the trail distance would put the stop below the entry: allowed (it still
  // only moves up), but a stop above the best price makes no sense, so distance must be > 0.
  return { start_r: Math.round(start * 100) / 100, distance_r: Math.round(dist * 100) / 100, no_target: v.no_target === true };
}

/** "Break-even at +1R, then trails 1R behind · no take profit". */
export function trailLabel(c: TrailConfig): string {
  const be = c.start_r === c.distance_r ? `Break-even at +${c.start_r}R, then trails ${c.distance_r}R behind` : `From +${c.start_r}R, trails ${c.distance_r}R behind`;
  return `${be}${c.no_target ? " · no take profit" : ""}`;
}
