/**
 * How a bot has really traded, from its closed trades. Pure: used by the bot page (browser)
 * and tested on its own.
 */

/** The fields of a closed trade the figures need (what /api/bots/:id/performance returns). */
export interface ClosedTrade {
  side: "buy" | "sell";
  pnl: number;
  risk_amount: number;
  opened_at: string;
  closed_at: string;
}

export interface SideStats {
  trades: number;
  winRate: number | null;
  pnl: number;
}

export interface Performance {
  trades: number;
  wins: number;
  losses: number;
  /** % of trades that made money (0–100), null with no trades. */
  winRate: number | null;
  net: number;
  grossProfit: number;
  grossLoss: number;
  /** Gross profit ÷ gross loss. Infinity when there were wins but no losses; null with no wins or losses. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Average result per trade. */
  expectancy: number | null;
  /** Average result per trade in units of the risk taken (R); null when trades carried no risk figure. */
  expectancyR: number | null;
  best: number | null;
  worst: number | null;
  /** Largest fall of the running P&L from a high, as a positive amount. */
  maxDrawdown: number;
  /** How far the running P&L is now below its high. */
  drawdownNow: number;
  longestWinStreak: number;
  longestLossStreak: number;
  /** Positive: wins in a row now; negative: losses in a row now. */
  streakNow: number;
  /** Average time in a trade, in minutes. */
  avgHoldMin: number | null;
  buys: SideStats;
  sells: SideStats;
  /** Running P&L after each trade, oldest first (for the curve). */
  curve: number[];
}

/** Below this many trades the figures say more about luck than about the bot. */
export const MIN_TRADES_TO_JUDGE = 30;

function sideStats(trades: ClosedTrade[]): SideStats {
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    trades: trades.length,
    winRate: trades.length ? Math.round((wins / trades.length) * 100) : null,
    pnl: round(trades.reduce((s, t) => s + t.pnl, 0)),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

export function performance(input: ClosedTrade[]): Performance {
  const trades = [...input].sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at));
  const winsList = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const lossList = trades.filter((t) => t.pnl < 0).map((t) => t.pnl);
  const grossProfit = round(winsList.reduce((s, x) => s + x, 0));
  const grossLoss = round(-lossList.reduce((s, x) => s + x, 0));
  const net = round(trades.reduce((s, t) => s + t.pnl, 0));

  let run = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve: number[] = [];
  let winStreak = 0;
  let lossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  for (const t of trades) {
    run += t.pnl;
    curve.push(round(run));
    peak = Math.max(peak, run);
    maxDrawdown = Math.max(maxDrawdown, peak - run);
    if (t.pnl > 0) {
      winStreak++;
      lossStreak = 0;
    } else if (t.pnl < 0) {
      lossStreak++;
      winStreak = 0;
    } // a break-even trade leaves the streaks as they are
    longestWinStreak = Math.max(longestWinStreak, winStreak);
    longestLossStreak = Math.max(longestLossStreak, lossStreak);
  }

  const risked = trades.filter((t) => t.risk_amount > 0);
  const holds = trades.map((t) => (Date.parse(t.closed_at) - Date.parse(t.opened_at)) / 60_000).filter((m) => Number.isFinite(m) && m >= 0);

  return {
    trades: trades.length,
    wins: winsList.length,
    losses: lossList.length,
    winRate: trades.length ? Math.round((winsList.length / trades.length) * 100) : null,
    net,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : null,
    avgWin: avg(winsList),
    avgLoss: avg(lossList),
    expectancy: avg(trades.map((t) => t.pnl)),
    expectancyR: risked.length ? round(risked.reduce((s, t) => s + t.pnl / t.risk_amount, 0) / risked.length) : null,
    best: trades.length ? round(Math.max(...trades.map((t) => t.pnl))) : null,
    worst: trades.length ? round(Math.min(...trades.map((t) => t.pnl))) : null,
    maxDrawdown: round(maxDrawdown),
    drawdownNow: round(peak - run),
    longestWinStreak,
    longestLossStreak,
    streakNow: winStreak || -lossStreak,
    avgHoldMin: holds.length ? Math.round(holds.reduce((s, m) => s + m, 0) / holds.length) : null,
    buys: sideStats(trades.filter((t) => t.side === "buy")),
    sells: sideStats(trades.filter((t) => t.side === "sell")),
    curve,
  };
}

/** "45 min", "3 h 20 min", "2 days". */
export function holdLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(min / 1440)} days`;
}
