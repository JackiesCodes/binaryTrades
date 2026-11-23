/**
 * Stuck-bot watchdog. A running bot that can't even look at the market (no price history, no
 * MT5 prices, no strategy) trades nothing, and nothing else would say so. After STUCK_AFTER_MS of
 * that, tell the user once; and say when it's checking the market again.
 */

export const STUCK_AFTER_MS = 2 * 3_600_000;

/** Verdicts that mean the bot couldn't check the market at all. (Errors are already reported as they happen.) */
export function isStuck(verdict: string): boolean {
  return verdict === "not enough data" || verdict === "waiting for MT5 prices" || verdict === "no strategy";
}

export interface CheckState {
  at: string;
  result: string;
  /** When the current stuck spell began (null when the bot is fine). */
  stuck_since?: string | null;
  /** Whether the user has been told about the current stuck spell. */
  stuck_warned?: boolean;
}

const hours = (ms: number) => {
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

/** The stuck fields after this check, and what (if anything) to tell the user. */
export function watchdog(
  prev: CheckState | null | undefined,
  verdict: string,
  botName: string,
  now = Date.now(),
): { stuck_since: string | null; stuck_warned: boolean; warn?: string; recovered?: string } {
  if (!isStuck(verdict)) {
    const recovered = prev?.stuck_warned ? `${botName} is checking the market again` : undefined;
    return { stuck_since: null, stuck_warned: false, recovered };
  }
  const since = prev?.stuck_since ?? new Date(now).toISOString();
  const stuckFor = now - Date.parse(since);
  if (prev?.stuck_warned || stuckFor < STUCK_AFTER_MS) return { stuck_since: since, stuck_warned: Boolean(prev?.stuck_warned) };
  const why =
    verdict === "not enough data"
      ? "not enough price history from the data feed"
      : verdict === "waiting for MT5 prices"
        ? "no prices from the MT5 bridge (is the EA running?)"
        : "it has no strategy";
  return {
    stuck_since: since,
    stuck_warned: true,
    warn: `${botName} can't trade: ${why}, for ${hours(stuckFor)}. It's still on and will carry on by itself once this clears.`,
  };
}
