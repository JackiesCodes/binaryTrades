"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";

import { WebhookSetup, botKind, botStats, useBotActions } from "@/components/app/bot-parts";
import { useDashboard } from "@/components/app/dashboard-context";
import { TradeChart, TradeDialog } from "@/components/app/trade-chart";
import { EmptyState, PageSkeleton, Panel, selectClass } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV, PositionCard, RangePills, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { money, pnlClass, price, timeAgo } from "@/lib/client";
import { getStrategy } from "@/lib/strategies";
import { DATA_SYMBOLS, timeframeLabel } from "@/lib/trading/symbols";
import type { Bot, Trade } from "@/lib/trading/types";

type Range = "1D" | "7D" | "1M";
const RANGE_S: Record<Range, number> = { "1D": 86400, "7D": 7 * 86400, "1M": 30 * 86400 };

export default function BotPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useDashboard();
  if (!state) return <PageSkeleton />;
  const bot = state.bots.find((b) => b.id === id);
  if (!bot) {
    return (
      <EmptyState>
        This bot doesn&apos;t exist any more.{" "}
        <Link href="/dashboard/bots" className="text-profit">
          Back to Bots →
        </Link>
      </EmptyState>
    );
  }
  return <BotView bot={bot} />;
}

function BotView({ bot }: { bot: Bot }) {
  const { state } = useDashboard();
  const router = useRouter();
  const { busy, broker, patch, signal, remove } = useBotActions(bot);
  const [range, setRange] = useState<Range>("7D");
  const [list, setList] = useState<"open" | "closed">("open");
  const [panel, setPanel] = useState<"settings" | "manual">("settings");
  const [risk, setRisk] = useState(String(bot.risk_percent));
  const [account, setAccount] = useState(bot.broker_account_id ?? "");
  const [selected, setSelected] = useState<Trade | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    setRisk(String(bot.risk_percent));
    setAccount(bot.broker_account_id ?? "");
  }, [bot.risk_percent, bot.broker_account_id]);

  if (!state) return null;
  const s = botStats(bot, state.open_trades, state.closed_trades);
  const kind = botKind(bot);
  const strategy = bot.strategy && bot.strategy.id !== "script" ? getStrategy(bot.strategy.id) : undefined;
  const runningNow = bot.status === "running";
  // Candles: at most ~300 bars of the bot's own timeframe.
  const span = Math.min(RANGE_S[range], bot.timeframe * 300);
  const from = now - span;
  const chartTrades = s.trades.filter((t) => Date.parse(t.opened_at) / 1000 >= from);
  const market = DATA_SYMBOLS.find((d) => d.value === bot.data_symbol)?.label ?? bot.data_symbol;
  const last = s.open[0]?.current_price;
  const dirty = Number(risk) !== bot.risk_percent || account !== (bot.broker_account_id ?? "");
  const tv = bot.source === "tradingview" || /function\s+onAlert\s*\(/.test(bot.strategy?.code ?? "");
  const list_ = list === "open" ? s.open : s.closed.slice().reverse();

  const save = () =>
    patch(
      {
        ...(Number(risk) !== bot.risk_percent ? { risk_percent: Number(risk) } : {}),
        ...(account !== (bot.broker_account_id ?? "") ? { broker_account_id: account } : {}),
      },
      "Settings saved",
    );

  return (
    <Workspace
      strip={
        <Strip
          icon={kind.icon}
          title={bot.name}
          sub={`${kind.label} · ${runningNow ? "Running" : "Paused"}`}
          action={
            <Link href="/dashboard/bots" className="text-xs text-muted-foreground hover:text-profit">
              <ArrowLeft className="inline h-3.5 w-3.5" /> Bots
            </Link>
          }
          stats={[
            { label: market, value: last ? price(last) : `${bot.symbol} · ${timeframeLabel(bot.timeframe)}` },
            { label: "P&L", value: money(s.pnl, broker?.currency, true), tone: pnlClass(s.pnl) },
            { label: "Win rate", value: s.winRate !== null ? `${s.winRate}% · ${s.closed.length}` : "—" },
            { label: "Risk", value: `${bot.risk_percent}%` },
            { label: "Last signal", value: bot.last_signal_at ? timeAgo(bot.last_signal_at) : "—" },
          ]}
        />
      }
      aside={
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-[13px]">
            <span className="truncate rounded-[9px] bg-white/[0.08] px-2 py-2 text-center text-ivory" title={broker?.label}>
              {broker?.label ?? "No account"}
            </span>
            <span className="truncate px-2 py-2 text-center text-muted-foreground">
              {broker?.kind === "deriv" ? `×${bot.deriv_multiplier}` : broker?.kind === "mt5" ? `Magic ${bot.magic}` : "—"}
            </span>
          </div>
          <Switcher
            value={runningNow ? "running" : "paused"}
            onChange={(v) => !busy && v !== bot.status && patch({ status: v }, v === "running" ? "Bot started" : "Bot paused")}
            options={[
              { value: "running", label: "Running" },
              { value: "paused", label: "Paused", tone: "gold" },
            ]}
          />
          {!runningNow && bot.paused_reason && <p className="-mt-1 text-xs text-amber-300">{bot.paused_reason}</p>}
          <Switcher
            accent={false}
            value={panel}
            onChange={setPanel}
            options={[
              { value: "settings", label: "Settings" },
              { value: "manual", label: "Manual trade" },
            ]}
          />

          {panel === "settings" ? (
            <>
              <FieldBox>
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">Risk per trade (%)</span>
                  <Input type="number" step="0.1" min="0.1" max="5" value={risk} onChange={(e) => setRisk(e.target.value)} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Account{s.open.length ? " · close its positions to change" : ""}
                  </span>
                  <select className={selectClass} value={account} onChange={(e) => setAccount(e.target.value)} disabled={s.open.length > 0}>
                    {!bot.broker_account_id && <option value="">Choose account…</option>}
                    {state.brokers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} · {b.is_demo ? "Demo" : "Real"}
                      </option>
                    ))}
                  </select>
                </label>
              </FieldBox>
              <KV
                rows={[
                  ["Market", `${bot.symbol} · ${timeframeLabel(bot.timeframe)}`],
                  ["Strategy", strategy?.name ?? kind.label],
                  ...(bot.strategy && bot.strategy.id !== "script"
                    ? Object.entries(bot.strategy.params)
                        .slice(0, 4)
                        .map(([k, v]) => [strategy?.params.find((p) => p.key === k)?.label ?? k, String(v)] as [string, string])
                    : []),
                  ["Price feed", bot.price_source === "broker" ? "MT5 broker" : "Deriv"],
                ]}
              />
              <Button onClick={save} disabled={busy || !dirty} className="h-12 w-full text-[15px] font-bold">
                Save settings
              </Button>
              {bot.strategy?.id === "script" && (
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/dashboard/scripts?bot=${bot.id}`}>Edit script</Link>
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Send an order now on {broker?.label ?? "this bot's account"}. It goes through Risk Guard and uses the bot&apos;s risk setting.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => signal("buy")} disabled={busy || !broker} className="h-12 text-[15px] font-bold">
                  Buy
                </Button>
                <Button onClick={() => signal("sell")} disabled={busy || !broker} variant="destructive" className="h-12 text-[15px] font-bold">
                  Sell
                </Button>
              </div>
              <Button onClick={() => signal("close")} disabled={busy || !s.open.length} variant="outline" className="w-full">
                Close position
              </Button>
            </>
          )}

          <div className="h-px bg-white/[0.06]" />
          <AsideTitle>Performance</AsideTitle>
          <KV
            rows={[
              ["P&L", money(s.pnl, broker?.currency, true), pnlClass(s.pnl)],
              ["Open positions", String(s.open.length)],
              ["Closed trades", String(s.closed.length)],
              ["Win rate", s.winRate !== null ? `${s.winRate}%` : "—"],
              ["Created", new Date(bot.created_at).toLocaleDateString()],
            ]}
          />
          <Button
            variant="ghost"
            className="w-full text-loss hover:bg-loss/10 hover:text-loss"
            disabled={busy}
            onClick={async () => {
              if (await remove()) router.push("/dashboard/bots");
            }}
          >
            <Trash2 /> Delete bot
          </Button>
        </>
      }
    >
      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ivory">
            {market} · {timeframeLabel(bot.timeframe)}
          </h2>
          <RangePills value={range} options={["1D", "7D", "1M"] as Range[]} onChange={setRange} />
        </div>
        <TradeChart key={range} symbol={bot.data_symbol} from={from} to={now} timeframe={bot.timeframe} trades={chartTrades} height={320} />
      </Panel>

      {tv && (
        <Panel title="TradingView setup">
          <WebhookSetup bot={bot} />
        </Panel>
      )}

      <Switcher
        accent={false}
        value={list}
        onChange={setList}
        className="w-full sm:w-fit"
        options={[
          { value: "open", label: `Open ${s.open.length}` },
          { value: "closed", label: `Closed ${s.closed.length}` },
        ]}
      />
      {list_.length ? (
        list_.slice(0, 20).map((t) => <PositionCard key={t.id} trade={t} onChart={setSelected} />)
      ) : (
        <EmptyState>{list === "open" ? "No open positions." : "No closed trades yet."}</EmptyState>
      )}
      <TradeDialog trade={selected} botName={bot.name} onClose={() => setSelected(null)} />
    </Workspace>
  );
}
