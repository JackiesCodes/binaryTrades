"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Code2, LineChart, Radio } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { CopyRow, Field, selectClass } from "@/components/app/widgets";
import { Switcher } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { STRATEGIES, defaultParams, getStrategy } from "@/lib/strategies";
import { DATA_SYMBOLS, TIMEFRAMES, guessDataSymbol } from "@/lib/trading/symbols";
import type { PublicBroker } from "@/lib/trading/state";
import type { Bot, Trade } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

/** What drives a bot, as a short label and an icon. */
export function botKind(bot: Bot): { label: string; icon: typeof LineChart } {
  if (bot.source === "tradingview") return { label: "TradingView alerts", icon: Radio };
  if (bot.strategy?.id === "script") return { label: "Script", icon: Code2 };
  return { label: (bot.strategy && getStrategy(bot.strategy.id)?.name) || "Strategy", icon: LineChart };
}

/** A bot's trades and simple stats. */
export function botStats(bot: Bot, open: Trade[], closed: Trade[]) {
  const trades = [...open, ...closed].filter((t) => t.bot_id === bot.id && t.status !== "rejected");
  const openTrades = trades.filter((t) => t.status === "open" || t.status === "pending");
  const closedTrades = trades.filter((t) => t.status === "closed");
  const wins = closedTrades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    open: openTrades,
    closed: closedTrades,
    pnl: trades.reduce((s, t) => s + t.pnl, 0),
    winRate: closedTrades.length ? Math.round((wins / closedTrades.length) * 100) : null,
  };
}

/** Start/pause, settings, manual orders and delete for one bot. */
export function useBotActions(bot: Bot) {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const broker = state?.brokers.find((b) => b.id === bot.broker_account_id);

  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (success) toast(success, "success");
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>, success?: string) => run(() => api(`/api/bots/${bot.id}`, "PATCH", body), success);

  const signal = async (action: "buy" | "sell" | "close") => {
    if (
      broker &&
      !broker.is_demo &&
      !(await confirm({
        title: `Send a real-money ${action.toUpperCase()} order?`,
        description: `${bot.symbol} on ${broker.label}. This uses real money and passes through Risk Guard first.`,
        confirmLabel: `${action === "close" ? "Close" : action === "buy" ? "Buy" : "Sell"} now`,
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await res.json()) as { status?: string; reason?: string | null };
      await refresh();
      if (result.status === "accepted") toast(action === "close" ? "Close order sent" : `${action.toUpperCase()} order sent`, "success");
      else toast(result.reason ?? "Order rejected", "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${bot.name}"?`,
      description: "Its open trades will be closed. This can't be undone.",
      confirmLabel: "Delete bot",
      danger: true,
    });
    if (!ok) return false;
    return run(() => api(`/api/bots/${bot.id}`, "DELETE"), "Bot deleted");
  };

  return { busy, broker, patch, signal, remove };
}

// ---------------------------------------------------------------------------

export function BotForm({ brokers, onDone }: { brokers: PublicBroker[]; onDone: () => void }) {
  const { refresh } = useDashboard();
  const params = useSearchParams();
  const router = useRouter();
  const presetStrategy = params.get("strategy");
  const presetParams = (() => {
    try {
      return JSON.parse(params.get("params") ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  })();

  const [source, setSource] = useState<"builtin" | "tradingview">(presetStrategy || !params.get("tv") ? "builtin" : "tradingview");
  const [name, setName] = useState("");
  const [brokerId, setBrokerId] = useState<string>(brokers[0]?.id ?? "");
  const broker = brokers.find((b) => b.id === brokerId);
  const [symbol, setSymbol] = useState(params.get("data_symbol") ?? "frxEURUSD");
  const [dataSymbol, setDataSymbol] = useState(params.get("data_symbol") ?? "frxEURUSD");
  const [timeframe, setTimeframe] = useState(Number(params.get("timeframe") ?? 3600));
  const [strategyId, setStrategyId] = useState(presetStrategy ?? STRATEGIES[0]!.id);
  const def = getStrategy(strategyId)!;
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>({ ...defaultParams(def), ...presetParams });
  const [risk, setRisk] = useState(1);
  const [multiplier, setMultiplier] = useState(100);
  const [priceSource, setPriceSource] = useState<"broker" | "deriv">("broker");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMt5 = broker?.kind === "mt5";

  // MT5 brokers name symbols like "EURUSD"/"EURUSDm"; Deriv uses its own codes ("frxEURUSD").
  useEffect(() => {
    if (isMt5 && /^(frx|cry)/.test(symbol)) setSymbol(symbol.slice(3));
    if (!isMt5 && !DATA_SYMBOLS.some((d) => d.value === symbol)) setSymbol(dataSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMt5]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/bots", "POST", {
        name: name || `${source === "builtin" ? def.name : "TradingView"} · ${symbol}`,
        source,
        broker_account_id: brokerId,
        symbol,
        data_symbol: isMt5 ? dataSymbol : symbol,
        price_source: isMt5 && source === "builtin" ? priceSource : "deriv",
        timeframe,
        strategy_id: source === "builtin" ? strategyId : undefined,
        strategy_params: source === "builtin" ? strategyParams : undefined,
        risk_percent: risk,
        deriv_multiplier: multiplier,
      });
      await refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Switcher
        value={source === "tradingview" ? "tradingview" : "builtin"}
        onChange={(v) => (v === "script" ? router.push("/dashboard/scripts") : setSource(v))}
        options={[
          { value: "builtin", label: "Strategy" },
          { value: "script", label: "Script" },
          { value: "tradingview", label: "TradingView" },
        ]}
      />

      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EURUSD Trend Rider" />
      </Field>

      <Field
        label="Broker account"
        hint={
          broker
            ? broker.is_demo
              ? "Demo account — trades use your broker's demo money."
              : "Real account — trades use real money."
            : undefined
        }
      >
        <select className={selectClass} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} · {b.kind === "mt5" ? "MT5" : "Deriv"} · {b.is_demo ? "Demo" : "Real"}
            </option>
          ))}
        </select>
      </Field>

      <div className={cn("grid gap-4", isMt5 ? "grid-cols-1" : "grid-cols-2")}>
        {isMt5 ? (
          <>
            <Field label="MT5 symbol" hint="Exactly as in Market Watch, e.g. EURUSDm on Exness.">
              <Input
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setDataSymbol(guessDataSymbol(e.target.value));
                }}
              />
            </Field>
            {source === "builtin" && (
              <Field
                label="Price feed"
                hint={priceSource === "broker" ? "This MT5 account's own candles (needs bridge EA v2)." : "Deriv market data for the market below."}
              >
                <select className={selectClass} value={priceSource} onChange={(e) => setPriceSource(e.target.value as "broker" | "deriv")}>
                  <option value="broker">MT5 broker prices (recommended)</option>
                  <option value="deriv">Deriv market data</option>
                </select>
              </Field>
            )}
            <Field label="Deriv market" hint="Used for prices when the price feed is Deriv, and as a fallback price.">
              <select className={selectClass} value={dataSymbol} onChange={(e) => setDataSymbol(e.target.value)}>
                {!DATA_SYMBOLS.some((d) => d.value === dataSymbol) && <option value={dataSymbol}>{dataSymbol}</option>}
                {DATA_SYMBOLS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Market">
            <select className={selectClass} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {DATA_SYMBOLS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Timeframe">
          <select className={selectClass} value={timeframe} onChange={(e) => setTimeframe(Number(e.target.value))}>
            {TIMEFRAMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {source === "builtin" && (
        <div className="space-y-3 rounded-[14px] bg-black/25 p-3">
          <Field label="Strategy" hint={def.description}>
            <select
              className={selectClass}
              value={strategyId}
              onChange={(e) => {
                setStrategyId(e.target.value);
                setStrategyParams(defaultParams(getStrategy(e.target.value)!));
              }}
            >
              {STRATEGIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.style}
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
                  value={strategyParams[p.key] ?? p.default}
                  onChange={(e) => setStrategyParams({ ...strategyParams, [p.key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Risk per trade (%)" hint="Loss if the stop is hit, as % of equity. 0.5–1% is sensible.">
          <Input type="number" step="0.1" min="0.1" max="5" value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
        </Field>
        {broker?.kind === "deriv" && (
          <Field label="Deriv multiplier" hint="Must be a value Deriv allows for this market.">
            <Input type="number" min="1" value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} />
          </Field>
        )}
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : broker?.is_demo === false ? "Create bot on real account" : "Create bot"}
      </Button>
    </form>
  );
}


export function WebhookSetup({ bot }: { bot: Bot }) {
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/api/webhooks/tradingview`;
  const message = JSON.stringify(
    {
      bot_id: bot.id,
      passphrase: bot.webhook_passphrase,
      action: "{{strategy.order.action}}",
      price: "{{close}}",
      id: "{{timenow}}",
    },
    null,
    0,
  ).replace('"{{close}}"', "{{close}}");
  const isScript = bot.strategy?.id === "script";

  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>In TradingView, open your strategy → <b className="text-foreground">Create alert</b>.</li>
        <li>
          Under <b className="text-foreground">Notifications</b>, tick <b className="text-foreground">Webhook URL</b> and paste the URL below.
        </li>
        <li>Paste the message below into the alert&apos;s <b className="text-foreground">Message</b> box and save.</li>
        <li>
          For indicator alerts (not strategies), replace <code>{"{{strategy.order.action}}"}</code> with <code>buy</code>, <code>sell</code> or{" "}
          <code>close</code>. You can add <code>&quot;sl&quot;</code> and <code>&quot;tp&quot;</code> prices too.
        </li>
        {isScript && (
          <li>
            Your script&apos;s <code>onAlert(alert, i)</code> decides what each alert does. Any extra fields you add to the message (for example{" "}
            <code>&quot;rsi&quot;: {"{{plot_0}}"}</code>) arrive in <code>alert</code>.
          </li>
        )}
      </ol>
      <CopyRow label="Webhook URL" value={url} />
      <CopyRow label="Alert message" value={message} />
      <p className="text-xs text-muted-foreground">Keep the passphrase private — anyone with it can send signals to this bot.</p>
    </div>
  );
}

