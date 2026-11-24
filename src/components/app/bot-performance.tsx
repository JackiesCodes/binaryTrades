"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState, Panel } from "@/components/app/widgets";
import { RangePills, Spark } from "@/components/app/workspace";
import { api, money, pnlClass } from "@/lib/client";
import { MIN_TRADES_TO_JUDGE, holdLabel, performance, type ClosedTrade } from "@/lib/trading/performance";
import { cn } from "@/lib/utils";

type Range = "7D" | "30D" | "All";
const RANGE_DAYS: Record<Range, number | null> = { "7D": 7, "30D": 30, All: null };

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/25 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate font-mono text-base font-semibold tabular-nums text-ivory", tone)}>{value}</div>
      {sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * The bot's real results from all its closed trades (not just the latest the dashboard holds):
 * profit factor, expectancy, drawdown, streaks, buys vs sells.
 */
export function BotPerformance({ botId, currency, closedCount }: { botId: string; currency?: string | null; closedCount: number }) {
  const [trades, setTrades] = useState<ClosedTrade[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("All");

  // Reload when the bot closes another trade.
  useEffect(() => {
    let cancelled = false;
    api<{ trades: ClosedTrade[]; capped: boolean }>(`/api/bots/${botId}/performance`).then(
      (r) => {
        if (cancelled) return;
        setTrades(r.trades);
        setCapped(r.capped);
        setError(null);
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [botId, closedCount]);

  const p = useMemo(() => {
    if (!trades) return null;
    const days = RANGE_DAYS[range];
    const since = days === null ? 0 : Date.now() - days * 86_400_000;
    return performance(trades.filter((t) => Date.parse(t.closed_at) >= since));
  }, [trades, range]);

  const m = (n: number | null, signed = true) => (n === null ? "—" : money(n, currency ?? undefined, signed));

  return (
    <Panel
      title="Performance"
      action={<RangePills value={range} options={["7D", "30D", "All"] as Range[]} onChange={setRange} />}
    >
      {error ? (
        <p className="text-sm text-loss">{error}</p>
      ) : !p ? (
        <div className="h-32 animate-pulse rounded-xl bg-white/[0.04]" />
      ) : !p.trades ? (
        <EmptyState>{range === "All" ? "No closed trades yet." : `No trades closed in the last ${range === "7D" ? "7" : "30"} days.`}</EmptyState>
      ) : (
        <div className="grid gap-3">
          {p.trades < MIN_TRADES_TO_JUDGE && (
            <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs text-gold">
              Only {p.trades} closed trade{p.trades === 1 ? "" : "s"}. Under {MIN_TRADES_TO_JUDGE}, these figures say more about luck than about the
              bot, so judge it on more trades before trusting it with real money.
            </p>
          )}
          {p.curve.length > 1 && <Spark values={[0, ...p.curve]} className="h-12" />}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Stat label="Net P&L" value={m(p.net)} tone={pnlClass(p.net)} sub={`${p.trades} trades`} />
            <Stat label="Win rate" value={p.winRate === null ? "—" : `${p.winRate}%`} sub={`${p.wins} won · ${p.losses} lost`} />
            <Stat
              label="Profit factor"
              value={p.profitFactor === null ? "—" : p.profitFactor === Infinity ? "No losses" : p.profitFactor.toFixed(2)}
              sub="won ÷ lost · above 1 is profit"
              tone={p.profitFactor !== null && p.profitFactor !== Infinity ? (p.profitFactor >= 1 ? "text-profit" : "text-loss") : undefined}
            />
            <Stat
              label="Per trade (average)"
              value={m(p.expectancy)}
              tone={p.expectancy !== null ? pnlClass(p.expectancy) : undefined}
              sub={p.expectancyR !== null ? `${p.expectancyR >= 0 ? "+" : ""}${p.expectancyR.toFixed(2)} × the risk taken` : undefined}
            />
            <Stat label="Average win" value={m(p.avgWin)} tone="text-profit" sub={p.best !== null ? `best ${m(p.best)}` : undefined} />
            <Stat label="Average loss" value={m(p.avgLoss)} tone="text-loss" sub={p.worst !== null ? `worst ${m(p.worst)}` : undefined} />
            <Stat
              label="Max drawdown"
              value={m(-p.maxDrawdown)}
              tone={p.maxDrawdown > 0 ? "text-loss" : undefined}
              sub={p.drawdownNow > 0 ? `${m(-p.drawdownNow)} below its high now` : "at its high now"}
            />
            <Stat
              label="Streaks"
              value={`${p.longestWinStreak} W · ${p.longestLossStreak} L`}
              sub={p.streakNow > 0 ? `${p.streakNow} win${p.streakNow === 1 ? "" : "s"} in a row now` : p.streakNow < 0 ? `${-p.streakNow} loss${p.streakNow === -1 ? "" : "es"} in a row now` : "longest in a row"}
            />
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Buys <b className={cn("font-mono font-semibold", pnlClass(p.buys.pnl))}>{m(p.buys.pnl)}</b>
              {p.buys.trades ? ` · ${p.buys.trades} · ${p.buys.winRate}% won` : " · none"}
            </span>
            <span>
              Sells <b className={cn("font-mono font-semibold", pnlClass(p.sells.pnl))}>{m(p.sells.pnl)}</b>
              {p.sells.trades ? ` · ${p.sells.trades} · ${p.sells.winRate}% won` : " · none"}
            </span>
            {p.avgHoldMin !== null && <span>Average time in a trade {holdLabel(p.avgHoldMin)}</span>}
          </p>
          {capped && range === "All" && <p className="text-[11px] text-muted-foreground">Based on the latest 2,000 closed trades.</p>}
        </div>
      )}
    </Panel>
  );
}
