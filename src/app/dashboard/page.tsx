"use client";

import Link from "next/link";
import { Check } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import {
  AreaChart,
  BotStatusBadge,
  BrokerStatusBadge,
  EmptyState,
  Kpi,
  Meter,
  PageHeader,
  PageSkeleton,
  Panel,
  PositionsTable,
  Segmented,
} from "@/components/app/widgets";
import { money, pct, pnlClass } from "@/lib/client";
import { timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

export default function OverviewPage() {
  const { state, error, view, setView } = useDashboard();

  if (!state) {
    return error ? <div className="py-20 text-center text-muted-foreground">{error}</div> : <PageSkeleton />;
  }

  const k = state.kpis[view];
  const settings = state.settings;
  const accounts = state.brokers.filter((b) => (b.is_demo ? "demo" : "real") === view);
  const accountIds = new Set(accounts.map((b) => b.id));
  const bots = state.bots.filter((b) => b.broker_account_id && accountIds.has(b.broker_account_id));
  const hasReal = state.brokers.some((b) => !b.is_demo);
  const hasDemo = state.brokers.some((b) => b.is_demo);
  const trades = state.open_trades.filter((t) => t.book === view);
  const curve = state.equity[view].map((p) => ({ x: Date.parse(p.created_at), y: p.equity }));
  const pnlByBot = new Map<string, number>();
  for (const t of [...state.open_trades, ...state.closed_trades]) {
    if (t.bot_id && t.status !== "rejected") pnlByBot.set(t.bot_id, (pnlByBot.get(t.bot_id) ?? 0) + t.pnl);
  }
  const dayLoss = Math.max(0, -k.today_pnl);
  const connected = accounts.filter((b) => b.status === "connected").length;
  // Equity = cash balance + current value of open trades (your broker's own "balance" excludes open trades).
  const balance = accounts.reduce((sum, b) => sum + b.balance, 0);
  const inTrades = accounts.reduce((sum, b) => sum + b.equity, 0) - balance;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description={
          !state.brokers.length
            ? "Your trading at a glance, once a broker account is connected."
            : view === "real"
              ? "Real-money accounts connected from your brokers."
              : "Demo accounts connected from your brokers — your broker's practice money."
        }
        action={
          hasReal && hasDemo ? (
            <Segmented
              value={view}
              onChange={setView}
              className="w-full sm:w-auto"
              options={[
                { value: "real", label: "Real accounts", activeClass: "bg-gold text-ink" },
                { value: "demo", label: "Demo accounts" },
              ]}
            />
          ) : undefined
        }
      />

      <GettingStarted />

      {!state.brokers.length ? (
        <Panel className="border-seal">
          <h2 className="text-base font-semibold text-ivory">Connect your first broker account</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            binaryTrades trades only through accounts you connect. Use a demo account at Exness or Deriv to practise with your broker&apos;s demo
            money, or a real account to trade real money. Everything on this dashboard comes from those accounts.
          </p>
          <Link
            href="/dashboard/brokers"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-profit px-4 text-sm font-semibold text-ink shadow-lift"
          >
            Connect Exness or Deriv
          </Link>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              className="col-span-2 lg:col-span-1"
              label={view === "real" ? "Total equity" : "Demo equity"}
              value={money(k.equity)}
              sub={
                inTrades > 0.005
                  ? `Balance ${money(balance)} + ${money(inTrades)} in open trades`
                  : `Balance ${money(balance)} · ${connected} of ${accounts.length} account${accounts.length === 1 ? "" : "s"}`
              }
            />
            <Kpi label="Today P&L" value={money(k.today_pnl, "USD", true)} tone={pnlClass(k.today_pnl)} sub="Since 00:00 UTC" />
            <Kpi label="Open positions" value={String(k.open_positions)} sub={`Limit ${settings.max_open_trades}`} />
            <Kpi
              label="Win rate (30d)"
              value={pct(k.win_rate_30d)}
              sub={k.closed_30d ? `${k.closed_30d} trades · PF ${k.profit_factor_30d?.toFixed(2) ?? "∞"}` : "No closed trades yet"}
            />
            <Kpi
              label="Drawdown"
              value={pct(-k.drawdown_percent)}
              tone={k.drawdown_percent > settings.max_drawdown_percent * 0.6 ? "text-amber-300" : undefined}
              sub={view === "real" ? `Kill switch at -${settings.max_drawdown_percent}%` : `Demo bots pause at -${settings.max_drawdown_percent}%`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
            <Panel title="Equity curve (30 days)">
              <AreaChart points={curve} />
            </Panel>
            <Panel
              title="My bots"
              action={
                <Link href="/dashboard/bots" className="text-xs text-muted-foreground hover:text-profit">
                  Manage →
                </Link>
              }
            >
              {bots.length ? (
                <ul className="divide-y divide-white/5">
                  {bots.slice(0, 6).map((bot) => {
                    const pnl = pnlByBot.get(bot.id) ?? 0;
                    const broker = state.brokers.find((b) => b.id === bot.broker_account_id);
                    return (
                      <li key={bot.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{bot.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {bot.source === "tradingview" ? "TradingView" : "Built-in"} · {bot.symbol} · {timeframeLabel(bot.timeframe)}
                            {broker ? ` · ${broker.label}` : ""}
                          </div>
                        </div>
                        <div className="text-right">
                          <BotStatusBadge bot={bot} />
                          <div className={cn("mt-1 font-mono text-xs", pnlClass(pnl))}>{money(pnl, "USD", true)}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState>
                  No bots on {view} accounts yet.{" "}
                  <Link href="/dashboard/bots?new=1" className="text-profit">
                    Create one →
                  </Link>
                </EmptyState>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[1.7fr_0.8fr_0.8fr]">
            <Panel title="Open positions" className="md:col-span-2 2xl:col-span-1">
              <PositionsTable trades={trades} />
            </Panel>
            <Panel
              title="Brokers"
              action={
                <Link href="/dashboard/brokers" className="text-xs text-muted-foreground hover:text-profit">
                  Manage →
                </Link>
              }
            >
              {accounts.length ? (
                <ul className="divide-y divide-white/5 text-sm">
                  {accounts.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate">{b.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {b.status === "connected" ? money(b.equity, b.currency) : (b.error ?? "Not connected")}
                        </div>
                      </div>
                      <BrokerStatusBadge broker={b} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>
                  <Link href="/dashboard/brokers?connect=1" className="text-profit">
                    Connect Exness or Deriv →
                  </Link>
                </EmptyState>
              )}
            </Panel>
            <Panel
              title="Risk Guard"
              action={
                <Link href="/dashboard/risk" className="text-xs text-muted-foreground hover:text-profit">
                  Edit →
                </Link>
              }
            >
              <div className="space-y-4">
                <Meter
                  label="Daily loss"
                  value={dayLoss}
                  max={settings.daily_loss_limit}
                  display={`${money(dayLoss)} / ${money(settings.daily_loss_limit)}`}
                />
                <Meter
                  label="Drawdown"
                  value={k.drawdown_percent}
                  max={settings.max_drawdown_percent}
                  display={`${k.drawdown_percent.toFixed(1)}% / ${settings.max_drawdown_percent}%`}
                />
                <Meter
                  label="Open trades"
                  value={k.open_positions}
                  max={settings.max_open_trades}
                  display={`${k.open_positions} / ${settings.max_open_trades}`}
                />
                <p className="text-xs text-muted-foreground">
                  Every order is checked here before it reaches a broker. Bots pause automatically when a limit is hit.
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function GettingStarted() {
  const { state } = useDashboard();
  if (!state) return null;
  const user = state.meta.user;
  const hasDemo = state.brokers.some((b) => b.is_demo);
  const steps = [
    { done: user.email_verified, label: "Confirm your email", href: "/dashboard/account", hint: "Needed before connecting a broker." },
    { done: state.brokers.length > 0, label: "Connect a demo account", href: "/dashboard/brokers", hint: "Deriv or any MetaTrader 5 broker." },
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
                "flex h-full gap-3 rounded-xl border p-3 transition-colors",
                s.done ? "border-profit/30 bg-profit/[0.06]" : "border-white/10 hover:border-profit/40",
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
