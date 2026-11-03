"use client";

import { useMemo, useState } from "react";
import { CandlestickChart } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { TradeDialog } from "@/components/app/trade-chart";
import { EmptyState, PageSkeleton, Panel, selectClass } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV, PositionCard, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { Badge } from "@/components/ui/badge";
import { money, pct, pnlClass, price } from "@/lib/client";
import type { Trade } from "@/lib/trading/types";

type Tab = "open" | "history" | "signals";
type Result = "all" | "won" | "lost";
type Period = "1" | "7" | "30" | "all";
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

/** "· incl. Deriv commission 4.12" in the close reason → 4.12 */
function commissionOf(t: Trade): number {
  const m = t.close_reason?.match(/commission\s+([\d.]+)/i);
  return m ? Number(m[1]) : 0;
}

export default function TradesPage() {
  const { state, view } = useDashboard();
  const [tab, setTab] = useState<Tab>("history");
  const [botId, setBotId] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [result, setResult] = useState<Result>("all");
  const [period, setPeriod] = useState<Period>("30");
  const [selected, setSelected] = useState<Trade | null>(null);

  const filtered = useMemo(() => {
    if (!state) return { open: [], closed: [] };
    const since = period === "all" ? 0 : Date.now() - Number(period) * 864e5;
    const keep = (t: Trade) =>
      t.book === view &&
      (botId === "all" || t.bot_id === botId) &&
      (accountId === "all" || t.broker_account_id === accountId);
    return {
      open: state.open_trades.filter(keep),
      closed: state.closed_trades.filter(
        (t) =>
          keep(t) &&
          t.status !== "rejected" &&
          Date.parse(t.closed_at ?? t.opened_at) >= since &&
          (result === "all" || (result === "won" ? t.pnl > 0 : t.pnl <= 0)),
      ),
    };
  }, [state, view, botId, accountId, result, period]);

  if (!state) return <PageSkeleton />;

  const bots = new Map(state.bots.map((b) => [b.id, b.name]));
  const accounts = state.brokers.filter((b) => (b.is_demo ? "demo" : "real") === view);
  const closed = filtered.closed;
  const net = closed.reduce((s, t) => s + t.pnl, 0);
  const commission = closed.reduce((s, t) => s + commissionOf(t), 0);
  const won = closed.filter((t) => t.pnl > 0);
  const lost = closed.filter((t) => t.pnl <= 0);
  const grossWin = won.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -lost.reduce((s, t) => s + t.pnl, 0);
  const best = closed.length ? Math.max(...closed.map((t) => t.pnl)) : null;
  const worst = closed.length ? Math.min(...closed.map((t) => t.pnl)) : null;
  const periodLabel = PERIODS.find((p) => p.value === period)!.label;
  const rejected = state.closed_trades.filter((t) => t.status === "rejected" && t.book === view).slice(0, 10);

  return (
    <Workspace
      strip={
        <Strip
          icon={CandlestickChart}
          title={botId === "all" ? "All bots" : bots.get(botId) ?? "Bot"}
          sub={`${periodLabel} · ${view === "real" ? "Real" : "Demo"} accounts`}
          stats={[
            { label: "Net P&L", value: money(net, "USD", true), tone: pnlClass(net) },
            { label: "Trades", value: String(closed.length) },
            { label: "Won", value: closed.length ? pct((won.length / closed.length) * 100, 0) : "—" },
            { label: "Commission", value: commission ? money(commission) : "—" },
            {
              label: "Best / worst",
              value: best !== null ? `${money(best, "USD", true)} / ${money(worst, "USD", true)}` : "—",
              className: "col-span-2 sm:col-span-1",
            },
          ]}
        />
      }
      aside={
        <>
          <AsideTitle>Filters</AsideTitle>
          <FieldBox>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Bot</span>
              <select className={selectClass} value={botId} onChange={(e) => setBotId(e.target.value)}>
                <option value="all">All bots</option>
                {state.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Account</span>
              <select className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="all">All {view} accounts</option>
                {accounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Period</span>
              <select className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </FieldBox>
          <Switcher
            value={result}
            onChange={setResult}
            options={[
              { value: "all", label: "All" },
              { value: "won", label: "Won" },
              { value: "lost", label: "Lost", tone: "loss" },
            ]}
          />
          <div className="h-px bg-white/[0.06]" />
          <AsideTitle>Summary</AsideTitle>
          <KV
            rows={[
              ["Won", `${won.length} · ${money(grossWin, "USD", true)}`, "text-profit"],
              ["Lost", `${lost.length} · ${money(-grossLoss, "USD", true)}`, grossLoss ? "text-loss" : undefined],
              ["Commission (Deriv)", commission ? money(-commission, "USD", true) : "—"],
              ["Net P&L", money(net, "USD", true), pnlClass(net)],
              ["Average trade", closed.length ? money(net / closed.length, "USD", true) : "—"],
              ["Profit factor", grossLoss ? (grossWin / grossLoss).toFixed(2) : closed.length ? "∞" : "—"],
            ]}
          />
        </>
      }
    >
      <TradeDialog trade={selected} botName={selected?.bot_id ? bots.get(selected.bot_id) : undefined} onClose={() => setSelected(null)} />
      <Switcher
        accent={false}
        value={tab}
        onChange={setTab}
        className="w-full sm:w-fit"
        options={[
          { value: "open", label: `Open ${filtered.open.length}` },
          { value: "history", label: `History ${closed.length}` },
          { value: "signals", label: "Signals" },
        ]}
      />

      {tab === "open" &&
        (filtered.open.length ? (
          filtered.open.map((t) => <PositionCard key={t.id} trade={t} onChart={setSelected} />)
        ) : (
          <EmptyState>No open positions{botId !== "all" || accountId !== "all" ? " for these filters" : ""}.</EmptyState>
        ))}

      {tab === "history" && (
        <>
          {closed.length ? (
            closed.slice(0, 60).map((t) => <PositionCard key={t.id} trade={t} onChart={setSelected} />)
          ) : (
            <EmptyState>No closed trades for these filters.</EmptyState>
          )}
          {closed.length > 60 && <p className="text-center text-xs text-muted-foreground">Showing the latest 60 of {closed.length} trades.</p>}
          {rejected.length > 0 && result === "all" && (
            <Panel title="Rejected orders">
              <ul className="divide-y divide-white/5 text-sm">
                {rejected.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <span>
                      <span className="font-semibold">{t.symbol}</span>{" "}
                      <span className="text-muted-foreground">
                        {t.side.toUpperCase()} · {(t.bot_id && bots.get(t.bot_id)) || "—"} · {when(t.opened_at)}
                      </span>
                    </span>
                    <span className="text-xs text-loss">{t.close_reason}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      {tab === "signals" && (
        <Panel>
          {state.signals.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {state.signals.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <div>
                    <span className="font-semibold">{(s.bot_id && bots.get(s.bot_id)) ?? "Unknown bot"}</span>{" "}
                    <span className="text-muted-foreground">
                      · {s.source} · {s.action.toUpperCase()} {s.symbol}
                      {s.price ? ` @ ${price(s.price)}` : ""}
                    </span>
                    {s.reason && <div className="text-xs text-muted-foreground">{s.reason}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{when(s.received_at)}</span>
                    <Badge variant={s.status === "accepted" ? "profit" : s.status === "duplicate" ? "muted" : "loss"}>{s.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No signals received yet.</EmptyState>
          )}
        </Panel>
      )}
    </Workspace>
  );
}
