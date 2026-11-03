"use client";

import { useState } from "react";
import Link from "next/link";
import { FlaskConical, Plus, Trophy } from "lucide-react";

import { EquityChart } from "@/components/app/equity-chart";
import { EmptyState, Field, MetricsGrid, Panel, selectClass } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, pct, pnlClass, price } from "@/lib/client";
import { STRATEGIES, defaultParams, getStrategy } from "@/lib/strategies";
import type { BacktestMetrics, BacktestResult, BacktestTrade, OptimiseEntry } from "@/lib/strategies/backtest";
import { DATA_SYMBOLS, TIMEFRAMES, timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

interface Range {
  from: number;
  to: number;
  bars: number;
}

function dateRange(r: Range) {
  const d = (s: number) => new Date(s * 1000).toLocaleDateString();
  return `${d(r.from)} → ${d(r.to)} · ${r.bars} candles`;
}

function deployHref(strategyId: string, params: Record<string, number>, dataSymbol: string, timeframe: number) {
  const q = new URLSearchParams({
    new: "1",
    strategy: strategyId,
    params: JSON.stringify(params),
    data_symbol: dataSymbol,
    timeframe: String(timeframe),
  });
  return `/dashboard/bots?${q}`;
}

const paramText = (p: Record<string, number>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");

export default function StrategyLabPage() {
  const [mode, setMode] = useState<"optimise" | "backtest">("optimise");
  const [dataSymbol, setDataSymbol] = useState("frxEURUSD");
  const [timeframe, setTimeframe] = useState(3600);
  const [risk, setRisk] = useState(1);
  const [cost, setCost] = useState(0.02);
  const [strategyId, setStrategyId] = useState(STRATEGIES[0]!.id);
  const [params, setParams] = useState<Record<string, number>>(defaultParams(STRATEGIES[0]!));
  const [busy, setBusy] = useState<"optimise" | "backtest" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<{ range: Range; leaderboard: OptimiseEntry[]; symbol: string; timeframe: number } | null>(null);
  const [selected, setSelected] = useState(0);
  const [single, setSingle] = useState<(BacktestResult & { range: Range; symbol: string; timeframe: number; strategyId: string; params: Record<string, number> }) | null>(null);
  // Which result the chart and numbers show.
  const [showing, setShowing] = useState<"board" | "single">("board");
  const def = getStrategy(strategyId)!;

  const common = { data_symbol: dataSymbol, timeframe, risk_percent: risk, cost_percent: cost };

  const run = async (action: "optimise" | "backtest") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "optimise") {
        const res = await api<{ range: Range; leaderboard: OptimiseEntry[] }>("/api/strategy-lab", "POST", { action, ...common });
        setBoard({ ...res, symbol: dataSymbol, timeframe });
        setSelected(0);
        setShowing("board");
      } else {
        const res = await api<BacktestResult & { range: Range }>("/api/strategy-lab", "POST", { action, ...common, strategy_id: strategyId, params });
        setSingle({ ...res, symbol: dataSymbol, timeframe, strategyId, params });
        setShowing("single");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pick = board?.leaderboard[selected];
  // The result on show: a leaderboard pick (judged on unseen data) or the single backtest.
  const view =
    showing === "board" && pick && board
      ? {
          title: `${pick.strategy_name} · unseen data`,
          metrics: pick.out_of_sample as BacktestMetrics,
          equity: pick.equity,
          trades: null as BacktestTrade[] | null,
          range: board.range,
          symbol: board.symbol,
          timeframe: board.timeframe,
          href: deployHref(pick.strategy_id, pick.params, board.symbol, board.timeframe),
          params: pick.params,
          train: pick.in_sample.return_percent,
        }
      : single
        ? {
            title: `${getStrategy(single.strategyId)?.name ?? "Strategy"} · full history`,
            metrics: single.metrics,
            equity: single.equity,
            trades: single.trades,
            range: single.range,
            symbol: single.symbol,
            timeframe: single.timeframe,
            href: deployHref(single.strategyId, single.params, single.symbol, single.timeframe),
            params: single.params,
            train: null as number | null,
          }
        : null;
  const marketLabel = (s: string) => DATA_SYMBOLS.find((d) => d.value === s)?.label ?? s;

  return (
    <Workspace
      asideFirstOnPhone={!view}
      strip={
        <Strip
          icon={FlaskConical}
          title="Strategy Lab"
          sub="Test strategies on real Deriv price history"
          stats={[
            { label: "Market", value: marketLabel(view?.symbol ?? dataSymbol) },
            { label: "Timeframe", value: timeframeLabel(view?.timeframe ?? timeframe) },
            {
              label: view?.trades ? "Return" : "Unseen-data return",
              value: view ? pct(view.metrics.return_percent, 1, true) : "—",
              tone: view ? pnlClass(view.metrics.return_percent) : undefined,
            },
            { label: "Max drawdown", value: view ? pct(-view.metrics.max_drawdown_percent) : "—" },
            { label: "Trades", value: view ? String(view.metrics.trades) : "—" },
          ]}
        />
      }
      aside={
        <>
          <Switcher
            value={mode}
            onChange={setMode}
            options={[
              { value: "optimise", label: "Find the best" },
              { value: "backtest", label: "Test one" },
            ]}
          />
          <FieldBox>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Market">
                <select className={selectClass} value={dataSymbol} onChange={(e) => setDataSymbol(e.target.value)}>
                  {DATA_SYMBOLS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Timeframe">
                <select className={selectClass} value={timeframe} onChange={(e) => setTimeframe(Number(e.target.value))}>
                  {TIMEFRAMES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risk per trade (%)">
                <Input type="number" step="0.1" value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
              </Field>
              <Field label="Cost / trade (%)">
                <Input type="number" step="0.005" value={cost} onChange={(e) => setCost(Number(e.target.value))} />
              </Field>
            </div>
            <p className="-mt-1 text-[11px] text-muted-foreground">Cost is spread + fees. 0.02% ≈ 2 pips on EURUSD.</p>
          </FieldBox>

          {mode === "optimise" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Tunes every strategy on the first 70% of the history and judges it only on the last 30% it has never seen.
              </p>
              <Button onClick={() => run("optimise")} disabled={busy !== null} className="h-12 w-full text-[15px] font-bold">
                <Trophy /> {busy === "optimise" ? "Training on history…" : "Find the best strategy"}
              </Button>
            </>
          ) : (
            <>
              <FieldBox>
                <Field label="Strategy" hint={def.style}>
                  <select
                    className={selectClass}
                    value={strategyId}
                    onChange={(e) => {
                      setStrategyId(e.target.value);
                      setParams(defaultParams(getStrategy(e.target.value)!));
                    }}
                  >
                    {STRATEGIES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  {def.params.map((p) => (
                    <Field key={p.key} label={p.label}>
                      <Input
                        type="number"
                        step="any"
                        value={params[p.key] ?? p.default}
                        onChange={(e) => setParams({ ...params, [p.key]: Number(e.target.value) })}
                      />
                    </Field>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">{def.description}</p>
              </FieldBox>
              <Button onClick={() => run("backtest")} disabled={busy !== null} className="h-12 w-full text-[15px] font-bold">
                <FlaskConical /> {busy === "backtest" ? "Running…" : "Run backtest"}
              </Button>
            </>
          )}
          {error && <p className="text-sm text-loss">{error}</p>}

          {view && (
            <>
              <div className="h-px bg-white/[0.06]" />
              <AsideTitle>Selected result</AsideTitle>
              <KV
                rows={[
                  ["Strategy", view.title.split(" · ")[0]!],
                  ...(view.train !== null ? [["Training return", pct(view.train, 1, true), pnlClass(view.train)] as [string, string, string]] : []),
                  [view.trades ? "Return" : "Unseen-data return", pct(view.metrics.return_percent, 1, true), pnlClass(view.metrics.return_percent)],
                  ["Win rate", pct(view.metrics.win_rate, 0)],
                  ["Profit factor", view.metrics.profit_factor === null ? "∞" : view.metrics.profit_factor.toFixed(2)],
                ]}
              />
              <Link
                href={view.href}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-profit text-[15px] font-bold text-ink hover:bg-profit/90"
              >
                <Plus className="h-4 w-4" /> Create bot from this
              </Link>
              <p className="rounded-[14px] bg-amber-400/[0.07] p-3 text-[11px] leading-relaxed text-amber-200">
                The unseen-data numbers are the honest ones; training returns always flatter. Even these can fade live. Run a new bot on a demo account for 2–4
                weeks before giving it real money.
              </p>
            </>
          )}
        </>
      }
    >
      {view ? (
        <>
          <Panel>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ivory">{view.title}</h2>
              <span className="text-xs text-muted-foreground">
                {marketLabel(view.symbol)} {timeframeLabel(view.timeframe)} · {dateRange(view.range)} · $10,000 start
              </span>
            </div>
            <EquityChart points={view.equity.map((p) => ({ x: p.epoch * 1000, y: p.equity }))} height={260} />
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{paramText(view.params)}</div>
          </Panel>
          <MetricsGrid m={view.metrics} />
        </>
      ) : (
        <Panel>
          <div className="py-10 text-center">
            <FlaskConical className="mx-auto h-8 w-8 text-profit" />
            <h2 className="mt-3 text-base font-semibold text-ivory">Pick a market and run a test</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              “Find the best” ranks every built-in strategy on history it hasn&apos;t seen. “Test one” runs a single strategy with your own settings.
            </p>
          </div>
        </Panel>
      )}

      {(board || single) && (
        <Switcher
          accent={false}
          value={showing}
          onChange={setShowing}
          className="w-full sm:w-fit"
          options={[
            { value: "board", label: board ? `Leaderboard ${board.leaderboard.length}` : "Leaderboard" },
            { value: "single", label: single ? `Backtest · ${single.trades.length} trades` : "Backtest" },
          ]}
        />
      )}

      {showing === "board" && board && (
        <>
          {board.leaderboard.map((e, i) => {
            const m = e.out_of_sample;
            const trusted = Number.isFinite(e.oos_score);
            return (
              <article
                key={e.strategy_id}
                onClick={() => setSelected(i)}
                className={cn(
                  "grid cursor-pointer gap-3 rounded-[18px] bg-panel p-4 ring-1 transition-colors md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-5",
                  i === selected ? "ring-profit/50" : "ring-transparent hover:ring-white/10",
                )}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-sm text-muted-foreground">#{i + 1}</span>
                    <span className="truncate font-bold text-ivory">{e.strategy_name}</span>
                    {!trusted && <Badge variant="warning">too few trades</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{paramText(e.params)}</div>
                  <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-xs sm:grid-cols-6 sm:gap-x-6">
                    {[
                      ["Unseen data", pct(m.return_percent, 1, true), pnlClass(m.return_percent)],
                      ["Training", pct(e.in_sample.return_percent, 1, true), pnlClass(e.in_sample.return_percent)],
                      ["Max DD", pct(-m.max_drawdown_percent), ""],
                      ["Win rate", pct(m.win_rate, 0), ""],
                      ["Profit factor", m.profit_factor === null ? "∞" : m.profit_factor.toFixed(2), ""],
                      ["Trades", String(m.trades), ""],
                    ].map(([k, v, tone]) => (
                      <div key={k} className="min-w-0">
                        <dt className="truncate text-muted-foreground">{k}</dt>
                        <dd className={cn("truncate font-mono text-sm tabular-nums text-ivory", tone)}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <Button size="sm" variant={i === 0 ? "default" : "outline"} asChild onClick={(ev) => ev.stopPropagation()}>
                  <Link href={deployHref(e.strategy_id, e.params, board.symbol, board.timeframe)}>
                    <Plus /> Create bot
                  </Link>
                </Button>
              </article>
            );
          })}
        </>
      )}
      {showing === "board" && !board && single && <EmptyState>Run “Find the best strategy” to rank every strategy on this market.</EmptyState>}

      {showing === "single" && single && (
        <Panel title="Backtest trades">
          {single.trades.length ? (
            <div className="scrollbar-thin max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Opened</th>
                    <th className="px-2 py-1.5 font-medium">Side</th>
                    <th className="px-2 py-1.5 font-medium">Entry → Exit</th>
                    <th className="px-2 py-1.5 font-medium">Exit reason</th>
                    <th className="px-2 py-1.5 text-right font-medium">R</th>
                    <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...single.trades].reverse().map((t, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1.5">{new Date(t.entry_epoch * 1000).toLocaleString()}</td>
                      <td className={cn("px-2 py-1.5", t.side === "buy" ? "text-profit" : "text-loss")}>{t.side.toUpperCase()}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {price(t.entry)} → {price(t.exit)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{t.reason}</td>
                      <td className={cn("px-2 py-1.5 text-right font-mono", pnlClass(t.r_multiple))}>{t.r_multiple.toFixed(2)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-mono", pnlClass(t.pnl))}>{money(t.pnl, "USD", true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>No trades in this period.</EmptyState>
          )}
        </Panel>
      )}
      {showing === "single" && !single && <EmptyState>Switch to “Test one” in the panel and run a backtest.</EmptyState>}
    </Workspace>
  );
}
