"use client";

import { useEffect, useState } from "react";
import { Octagon, ShieldCheck } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { useKillSwitch } from "@/components/app/kill-switch";
import { AsideTitle, KV, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { PageSkeleton, Panel } from "@/components/app/widgets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money } from "@/lib/client";

const FIELDS = [
  {
    key: "daily_loss_limit",
    label: "Daily loss limit ($)",
    hint: "Checked separately for real and demo accounts. When today's loss reaches this, bots on those accounts pause until you restart them.",
  },
  {
    key: "max_drawdown_percent",
    label: "Max drawdown (%)",
    hint: "Drop from the equity peak. On real accounts it fires the kill switch (all bots pause, all positions close); on demo accounts it pauses the demo bots.",
  },
  { key: "max_open_trades", label: "Max open trades", hint: "Across all bots on real accounts, and separately on demo accounts." },
  { key: "max_trades_per_bot", label: "Max trades per bot", hint: "1 = a bot holds at most one position at a time." },
  { key: "default_risk_percent", label: "Default risk per trade (%)", hint: "Used when a bot doesn't set its own. Hard-capped at 5%." },
] as const;

type Key = (typeof FIELDS)[number]["key"];

export default function RiskPage() {
  const { state, refresh, view } = useDashboard();
  const { toast } = useFeedback();
  const [form, setForm] = useState<Record<Key, number> | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state && !form) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, state.settings[f.key]])) as Record<Key, number>);
  }, [state, form]);

  if (!state || !form) return <PageSkeleton />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/settings", "PATCH", form);
      await refresh();
      setSaved(true);
      toast("Risk limits saved", "success");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const book = view;
  const k = state.kpis[book];
  const loss = Math.max(0, -k.today_pnl);
  const openTrades = state.open_trades.filter((t) => t.book === book);
  const perBot = Math.max(0, ...state.bots.map((b) => openTrades.filter((t) => t.bot_id === b.id).length));
  const usage: Record<Key, { now: string; ratio: number } | null> = {
    daily_loss_limit: { now: `${money(loss)} lost today`, ratio: loss / (form.daily_loss_limit || 1) },
    max_drawdown_percent: { now: `${k.drawdown_percent.toFixed(1)}% below the peak (${money(state.settings.books[book].peak_equity)})`, ratio: k.drawdown_percent / (form.max_drawdown_percent || 1) },
    max_open_trades: { now: `${openTrades.length} open now`, ratio: openTrades.length / (form.max_open_trades || 1) },
    max_trades_per_bot: { now: `Busiest bot has ${perBot} open`, ratio: perBot / (form.max_trades_per_bot || 1) },
    default_risk_percent: null,
  };
  const atRisk = openTrades.reduce((s, t) => s + t.risk_amount, 0);
  const unrealised = openTrades.reduce((s, t) => s + t.pnl, 0);
  const running = state.bots.filter((b) => b.status === "running").length;

  return (
    <Workspace
      strip={
        <Strip
          icon={ShieldCheck}
          title={book === "real" ? "Real accounts" : "Demo accounts"}
          sub="Checked before every order"
          stats={[
            { label: "Daily loss", value: `${money(loss)} / ${money(state.settings.daily_loss_limit)}`, tone: loss >= state.settings.daily_loss_limit * 0.8 ? "text-loss" : undefined },
            { label: "Drawdown", value: `${k.drawdown_percent.toFixed(1)}% / ${state.settings.max_drawdown_percent}%` },
            { label: "Open trades", value: `${k.open_positions} / ${state.settings.max_open_trades}` },
            { label: "Peak equity", value: money(state.settings.books[book].peak_equity) },
            { label: "Kill switch", value: state.settings.kill_switch ? "ON" : "Off", tone: state.settings.kill_switch ? "text-loss" : "text-profit" },
          ]}
        />
      }
      aside={
        <>
          <KillSwitchAside running={running} open={openTrades.length} atRisk={atRisk} unrealised={unrealised} />
          <div className="h-px bg-white/[0.06]" />
          <p className="text-xs text-muted-foreground">Limits apply to real and demo accounts separately. Bots pause automatically when one is hit.</p>
          <Button type="submit" form="risk-limits" disabled={busy} className="h-12 w-full text-[15px] font-bold">
            {saved ? "Saved ✓" : busy ? "Saving…" : "Save limits"}
          </Button>
        </>
      }
    >
      {!state.brokers.length && (
        <Panel>
          <p className="text-sm text-muted-foreground">Connect a broker account to see its risk usage here.</p>
        </Panel>
      )}
      <form id="risk-limits" onSubmit={save} className="flex flex-col gap-3.5">
        {FIELDS.map((f) => {
          const u = usage[f.key];
          const ratio = u ? Math.min(Math.max(u.ratio, 0), 1) : 0;
          return (
            <section key={f.key} className="grid gap-3 rounded-[18px] bg-panel p-4 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center sm:gap-6 sm:px-5">
              <div className="min-w-0">
                <label htmlFor={`lim-${f.key}`} className="font-bold text-ivory">
                  {f.label}
                </label>
                <p className="text-xs text-muted-foreground">{f.hint}</p>
                {u && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className={ratio >= 0.9 ? "h-full rounded-full bg-loss" : ratio >= 0.6 ? "h-full rounded-full bg-amber-400" : "h-full rounded-full bg-profit"}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{u.now}</p>
                  </>
                )}
              </div>
              <Input
                id={`lim-${f.key}`}
                type="number"
                step="any"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
                className="h-11 bg-black/30 text-center font-mono text-base"
              />
            </section>
          );
        })}
      </form>
    </Workspace>
  );
}

function KillSwitchAside({ running, open, atRisk, unrealised }: { running: number; open: number; atRisk: number; unrealised: number }) {
  const kill = useKillSwitch();
  return (
    <>
      <AsideTitle icon={Octagon}>Kill switch</AsideTitle>
      <Switcher
        value={kill.on ? "on" : "off"}
        onChange={(v) => (v === "on") !== kill.on && kill.toggle()}
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On", tone: "loss" },
        ]}
      />
      <p className="rounded-[14px] bg-black/25 p-3 text-sm text-muted-foreground">
        {kill.on
          ? "No new trades will be placed. Releasing it does not restart bots — start each one again from Bots."
          : "Emergency stop: pauses every bot and closes every open position on all your accounts, including other EAs on your MT5 accounts."}
      </p>
      <KV
        rows={[
          ["Running bots", String(running)],
          ["Open positions", String(open)],
          ["At risk now", money(atRisk)],
          ["Unrealised P&L", money(unrealised, "USD", true), unrealised > 0 ? "text-profit" : unrealised < 0 ? "text-loss" : undefined],
        ]}
      />
      <Button variant={kill.on ? "outline" : "destructive"} onClick={kill.toggle} disabled={kill.busy || !kill.ready} className="h-12 w-full text-[15px] font-bold">
        <Octagon /> {kill.on ? "Release kill switch" : "Stop everything"}
      </Button>
    </>
  );
}
