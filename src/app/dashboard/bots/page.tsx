"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot as BotIcon, ExternalLink, Pause, Play } from "lucide-react";

import { BotForm, botKind, botStats, useBotActions } from "@/components/app/bot-parts";
import { useDashboard } from "@/components/app/dashboard-context";
import { KillSwitchButton } from "@/components/app/kill-switch";
import { EmptyState, PageSkeleton } from "@/components/app/widgets";
import { AsideTitle, IconTile, Spark, Strip, Switcher, Workspace, cumulative } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { money, pnlClass } from "@/lib/client";
import { timeframeLabel } from "@/lib/trading/symbols";
import type { Bot } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

export default function BotsPage() {
  return (
    <Suspense>
      <BotsPageInner />
    </Suspense>
  );
}

type Filter = "all" | "running" | "paused";

function BotsPageInner() {
  const { state, view } = useDashboard();
  const params = useSearchParams();
  const formRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [formKey, setFormKey] = useState(0);

  // "New bot" links elsewhere land here with ?new=1: bring the form into view.
  useEffect(() => {
    if (params.get("new") && state) setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [params, state]);

  if (!state) return <PageSkeleton />;

  const accounts = new Set(state.brokers.filter((b) => (b.is_demo ? "demo" : "real") === view).map((b) => b.id));
  const hasBoth = state.brokers.some((b) => b.is_demo) && state.brokers.some((b) => !b.is_demo);
  // Bots follow the Real / Demo switch; bots without an account always show.
  const all = state.bots.filter((b) => !hasBoth || !b.broker_account_id || accounts.has(b.broker_account_id));
  const running = all.filter((b) => b.status === "running");
  const shown = filter === "all" ? all : filter === "running" ? running : all.filter((b) => b.status !== "running");
  const stats = new Map(all.map((b) => [b.id, botStats(b, state.open_trades, state.closed_trades)]));
  const totalPnl = [...stats.values()].reduce((s, x) => s + x.pnl, 0);
  const best = [...all].sort((a, b) => (stats.get(b.id)?.pnl ?? 0) - (stats.get(a.id)?.pnl ?? 0))[0];

  return (
    <Workspace
      strip={
        <Strip
          icon={BotIcon}
          title="Bots"
          sub={hasBoth ? (view === "real" ? "On real accounts" : "On demo accounts") : "All your bots"}
          stats={[
            { label: "Bots", value: String(all.length) },
            { label: "Running", value: String(running.length), tone: running.length ? "text-profit" : undefined },
            { label: "Paused", value: String(all.length - running.length) },
            { label: "P&L", value: money(totalPnl, "USD", true), tone: pnlClass(totalPnl) },
            { label: "Best", value: best && (stats.get(best.id)?.pnl ?? 0) > 0 ? best.name : "—", className: "max-w-[180px]" },
          ]}
        />
      }
      aside={
        <div ref={formRef} className="flex scroll-mt-24 flex-col gap-3.5">
          {all.length > 0 && <KillSwitchButton className="w-full" variantOff="ghost" />}
          <AsideTitle>New bot</AsideTitle>
          {state.brokers.length ? (
            <>
              <p className="text-xs text-muted-foreground">
                It trades on the account you choose (demo money or real money) and starts paused.
              </p>
              <BotForm key={formKey} brokers={state.brokers} onDone={() => setFormKey((k) => k + 1)} />
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Connect an Exness or Deriv account first — every bot trades on one of your accounts.</p>
              <Button asChild className="w-full">
                <Link href="/dashboard/brokers?connect=1">Connect a broker account</Link>
              </Button>
            </div>
          )}
        </div>
      }
    >
      <Switcher
        accent={false}
        value={filter}
        onChange={setFilter}
        className="w-full sm:w-fit"
        options={[
          { value: "all", label: `All ${all.length}` },
          { value: "running", label: `Running ${running.length}` },
          { value: "paused", label: `Paused ${all.length - running.length}` },
        ]}
      />
      {shown.length ? (
        shown.map((bot) => <BotRow key={bot.id} bot={bot} />)
      ) : (
        <EmptyState>
          {all.length
            ? `No ${filter} bots.`
            : "No bots yet. A bot trades on the broker account you choose — use a demo account to practise before trading real money."}
        </EmptyState>
      )}
    </Workspace>
  );
}

function BotRow({ bot }: { bot: Bot }) {
  const { state } = useDashboard();
  const { busy, broker, patch } = useBotActions(bot);
  if (!state) return null;
  const s = botStats(bot, state.open_trades, state.closed_trades);
  const kind = botKind(bot);
  const runningNow = bot.status === "running";

  return (
    <article className="grid gap-3 rounded-[18px] bg-panel p-4 md:grid-cols-[minmax(0,1fr)_210px_auto] md:items-center md:gap-5">
      <Link href={`/dashboard/bots/${bot.id}`} className="min-w-0">
        <div className="flex items-center gap-3">
          <IconTile icon={kind.icon} tone={runningNow ? "profit" : "gold"} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate font-bold text-ivory">{bot.name}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  runningNow ? "bg-profit/15 text-profit" : "bg-gold/15 text-gold",
                )}
              >
                {runningNow ? "Running" : bot.paused_reason ? `Paused · ${bot.paused_reason}` : "Paused"}
              </span>
              {broker && !broker.is_demo && <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">REAL</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {kind.label} · {broker?.label ?? "no account"}
            </div>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-x-4 text-xs sm:w-fit sm:gap-x-7">
          {[
            ["Market", bot.symbol],
            ["Timeframe", timeframeLabel(bot.timeframe)],
            ["Risk", `${bot.risk_percent}%`],
            ["Trades · won", `${s.closed.length}${s.winRate !== null ? ` · ${s.winRate}%` : ""}`],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono text-sm tabular-nums text-ivory">{v}</dd>
            </div>
          ))}
        </dl>
      </Link>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">P&amp;L{s.open.length ? ` · ${s.open.length} open` : ""}</div>
        <div className={cn("font-mono text-lg font-semibold tabular-nums", pnlClass(s.pnl))}>{money(s.pnl, broker?.currency, true)}</div>
        <Spark values={cumulative(s.trades)} />
      </div>
      <div className="flex gap-1 text-muted-foreground md:flex-col">
        <button
          onClick={() => patch({ status: runningNow ? "paused" : "running" }, runningNow ? "Bot paused" : "Bot started")}
          disabled={busy}
          className={cn(
            "flex items-center gap-1.5 rounded-lg p-1.5 hover:bg-white/[0.06] hover:text-ivory disabled:opacity-40",
            !runningNow && "text-profit",
          )}
          aria-label={runningNow ? "Pause bot" : "Start bot"}
          title={runningNow ? "Pause" : "Start"}
        >
          {runningNow ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="text-xs md:hidden">{runningNow ? "Pause" : "Start"}</span>
        </button>
        <Link
          href={`/dashboard/bots/${bot.id}`}
          className="flex items-center gap-1.5 rounded-lg p-1.5 hover:bg-white/[0.06] hover:text-ivory"
          aria-label="Open bot"
          title="Open bot"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="text-xs md:hidden">Open</span>
        </Link>
      </div>
    </article>
  );
}
