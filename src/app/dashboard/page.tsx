"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, Plus, ShieldCheck, Wallet } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { CHART_RANGES, EquityChart, inRange, type ChartRange } from "@/components/app/equity-chart";
import { TradeDialog } from "@/components/app/trade-chart";
import { EmptyState, PageSkeleton, Panel } from "@/components/app/widgets";
import { AsideTitle, KV, PositionCard, RangePills, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { money, pct, pnlClass } from "@/lib/client";
import type { Trade } from "@/lib/trading/types";
import { timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const { state, error, view } = useDashboard();
  const [range, setRange] = useState<ChartRange>("1M");
  const [list, setList] = useState<"open" | "recent">("open");
  const [botFilter, setBotFilter] = useState<"running" | "paused">("running");
  const [selected, setSelected] = useState<Trade | null>(null);

  const curve = useMemo(
    () => (state ? state.equity[view].map((p) => ({ x: Date.parse(p.created_at), y: p.equity })) : []),
    [state, view],
  );

  if (!state) {
    return error ? <div className="py-20 text-center text-muted-foreground">{error}</div> : <PageSkeleton />;
  }

  const k = state.kpis[view];
  const settings = state.settings;
  const accounts = state.brokers.filter((b) => (b.is_demo ? "demo" : "real") === view);
  const accountIds = new Set(accounts.map((b) => b.id));
  const bots = state.bots.filter((b) => b.broker_account_id && accountIds.has(b.broker_account_id));
  const open = state.open_trades.filter((t) => t.book === view);
  const recent = state.closed_trades.filter((t) => t.book === view && t.status !== "rejected").slice(0, 6);
  const pnlByBot = new Map<string, number>();
  for (const t of [...state.open_trades, ...state.closed_trades]) {
    if (t.bot_id && t.status !== "rejected") pnlByBot.set(t.bot_id, (pnlByBot.get(t.bot_id) ?? 0) + t.pnl);
  }
  const balance = accounts.reduce((sum, b) => sum + b.balance, 0);
  const inTrades = accounts.reduce((sum, b) => sum + b.equity, 0) - balance;
  const attention = accounts.filter((b) => b.status !== "connected");
  const dayLoss = Math.max(0, -k.today_pnl);
  const running = bots.filter((b) => b.status === "running");
  const paused = bots.filter((b) => b.status !== "running");
  const shownBots = botFilter === "running" ? running : paused;
  const botName = selected?.bot_id ? state.bots.find((b) => b.id === selected.bot_id)?.name : undefined;

  if (!state.brokers.length) {
    return (
      <Workspace>
        <GettingStarted />
        <Panel className="border-seal">
          <h2 className="text-base font-semibold text-ivory">Connect your first broker account</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            binaryTrades trades only through accounts you connect. Use a demo account at Exness or Deriv to practise with your broker&apos;s demo
            money, or a real account to trade real money. Everything on this dashboard comes from those accounts.
          </p>
          <Link
            href="/dashboard/brokers?connect=1"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-profit px-4 text-sm font-semibold text-ink"
          >
            Connect Exness or Deriv
          </Link>
        </Panel>
      </Workspace>
    );
  }

  return (
    <Workspace
      strip={
        <Strip
          icon={Wallet}
          title={view === "real" ? "Real accounts" : "Demo accounts"}
          sub={`${accounts.length} account${accounts.length === 1 ? "" : "s"} · ${view === "real" ? "real money" : "your broker's practice money"}`}
          stats={[
            { label: "Equity", value: money(k.equity), className: "col-span-2 sm:col-span-1" },
            { label: "Today", value: money(k.today_pnl, "USD", true), tone: pnlClass(k.today_pnl) },
            { label: "Win rate · 30d", value: k.closed_30d ? `${pct(k.win_rate_30d, 0)} · ${k.closed_30d}` : "—" },
            {
              label: "Drawdown",
              value: `${k.drawdown_percent.toFixed(1)}% / ${settings.max_drawdown_percent}%`,
              tone: k.drawdown_percent > settings.max_drawdown_percent * 0.6 ? "text-amber-300" : undefined,
            },
            { label: "Open", value: `${k.open_positions} / ${settings.max_open_trades}` },
          ]}
        />
      }
      aside={
        <>
          <AsideTitle>My bots</AsideTitle>
          <Switcher
            value={botFilter}
            onChange={setBotFilter}
            options={[
              { value: "running", label: `Running ${running.length}` },
              { value: "paused", label: `Paused ${paused.length}` },
            ]}
          />
          <div className="rounded-[14px] bg-black/25 px-3">
            {shownBots.length ? (
              shownBots.slice(0, 5).map((bot) => {
                const pnl = pnlByBot.get(bot.id) ?? 0;
                return (
                  <Link
                    key={bot.id}
                    href={`/dashboard/bots/${bot.id}`}
                    className="flex items-center gap-3 border-b border-white/[0.06] py-2.5 last:border-0 hover:opacity-90"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ivory">{bot.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {bot.symbol} · {timeframeLabel(bot.timeframe)} · {bot.source === "tradingview" ? "TradingView" : bot.strategy?.id === "script" ? "Script" : "Strategy"}
                      </div>
                    </div>
                    <span className={cn("font-mono text-xs tabular-nums", pnlClass(pnl))}>{money(pnl, "USD", true)}</span>
                  </Link>
                );
              })
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">No {botFilter} bots on {view} accounts.</p>
            )}
          </div>
          <Link
            href="/dashboard/bots?new=1"
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-profit text-[15px] font-bold text-ink hover:bg-profit/90"
          >
            <Plus className="h-4 w-4" /> New bot
          </Link>

          <div className="h-px bg-white/[0.06]" />
          <div className="flex items-center justify-between">
            <AsideTitle icon={ShieldCheck}>Risk Guard</AsideTitle>
            <Link href="/dashboard/risk" className="text-xs text-muted-foreground hover:text-profit">
              Edit →
            </Link>
          </div>
          <KV
            rows={[
              ["Daily loss", `${money(dayLoss)} / ${money(settings.daily_loss_limit)}`, dayLoss >= settings.daily_loss_limit * 0.8 ? "text-loss" : undefined],
              ["Drawdown", `${k.drawdown_percent.toFixed(1)}% / ${settings.max_drawdown_percent}%`],
              ["Open trades", `${k.open_positions} / ${settings.max_open_trades}`],
              ["Max trades per bot", String(settings.max_trades_per_bot)],
              ["Kill switch", settings.kill_switch ? "ON" : "Off", settings.kill_switch ? "text-loss" : "text-profit"],
            ]}
          />
          {inTrades > 0.005 && (
            <p className="text-xs text-muted-foreground">
              Equity = balance {money(balance)} + {money(inTrades)} in open trades.
            </p>
          )}
          {attention.length > 0 && (
            <Link href="/dashboard/brokers" className="flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {attention.length} account{attention.length === 1 ? " needs" : "s need"} attention: {attention.map((a) => a.label).join(", ")}
              </span>
            </Link>
          )}
        </>
      }
    >
      <GettingStarted />

      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ivory">Equity</h2>
          <RangePills value={range} options={CHART_RANGES} onChange={setRange} />
        </div>
        <EquityChart points={inRange(curve, range)} />
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Switcher
          accent={false}
          value={list}
          onChange={setList}
          className="w-full sm:w-auto"
          options={[
            { value: "open", label: `Open positions ${open.length}` },
            { value: "recent", label: "Recent trades" },
          ]}
        />
        <Link href="/dashboard/trades" className="text-xs text-muted-foreground hover:text-profit">
          All trades →
        </Link>
      </div>
      {(list === "open" ? open : recent).length ? (
        (list === "open" ? open : recent).map((t) => <PositionCard key={t.id} trade={t} onChart={setSelected} />)
      ) : (
        <EmptyState>{list === "open" ? `No open positions on ${view} accounts.` : "No closed trades yet."}</EmptyState>
      )}
      <TradeDialog trade={selected} botName={botName} onClose={() => setSelected(null)} />
    </Workspace>
  );
}

function GettingStarted() {
  const { state } = useDashboard();
  if (!state) return null;
  const user = state.meta.user;
  const hasDemo = state.brokers.some((b) => b.is_demo);
  const steps = [
    { done: user.email_verified, label: "Confirm your email", href: "/dashboard/account", hint: "Needed before connecting a broker." },
    { done: state.brokers.length > 0, label: "Connect a demo account", href: "/dashboard/brokers?connect=1", hint: "Deriv or any MetaTrader 5 broker." },
    {
      done: state.bots.length > 0,
      label: "Test a strategy and create your first bot",
      href: "/dashboard/strategy-lab",
      hint: "Or write your own in Scripts.",
    },
    { done: state.bots.some((b) => b.status === "running"), label: "Start it on your demo account", href: "/dashboard/bots", hint: "Watch it for 2–4 weeks before real money." },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  if (!remaining || (hasDemo && state.bots.some((b) => b.status === "running"))) return null;
  return (
    <Panel title={`Getting started · ${steps.length - remaining} of ${steps.length} done`}>
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link
              href={s.href}
              className={cn(
                "flex h-full gap-3 rounded-xl p-3 transition-colors",
                s.done ? "bg-profit/[0.06]" : "bg-black/25 hover:bg-black/40",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                  s.done ? "border-profit bg-profit text-ink" : "border-white/20 text-muted-foreground",
                )}
              >
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", s.done ? "text-muted-foreground line-through" : "text-ivory")}>{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
