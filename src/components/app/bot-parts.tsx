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
import { api, brokerOptionLabel } from "@/lib/client";
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
  const [risk, setRisk] = useState<RiskValue>(riskValueOf());
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
        ...riskBody(risk),
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
              {brokerOptionLabel(b, true)}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4">
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
          <Field label="Strategy" hint={`${def.style}. ${def.description}`}>
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
                  value={strategyParams[p.key] ?? p.default}
                  onChange={(e) => setStrategyParams({ ...strategyParams, [p.key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
        </div>
      )}

      <RiskField value={risk} onChange={setRisk} currency={broker?.currency} />
      <div className="grid grid-cols-2 gap-4">
        {broker?.kind === "deriv" && (
          <Field label="Deriv multiplier" hint="Must be a value Deriv allows for this market.">
            <Input type="number" min="1" value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} />
          </Field>
        )}
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || Boolean(riskError(risk))}>
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

// ---------------------------------------------------------------------------
// Risk per trade: a % of the account, or a fixed amount (e.g. $25)

export interface RiskValue {
  mode: "percent" | "amount";
  percent: number;
  amount: number;
}

export function riskValueOf(bot?: Pick<Bot, "risk_percent" | "risk_amount">): RiskValue {
  return bot?.risk_amount
    ? { mode: "amount", percent: bot.risk_percent, amount: bot.risk_amount }
    : { mode: "percent", percent: bot?.risk_percent ?? 1, amount: 25 };
}

/** What's wrong with a RiskValue, or null when it can be saved. */
export function riskError(r: RiskValue): string | null {
  if (r.mode === "percent") {
    if (!Number.isFinite(r.percent) || r.percent < 0.1 || r.percent > 5) {
      return "Use 0.1–5% of the account. For a dollar amount like $25, switch to Fixed.";
    }
    return null;
  }
  if (!Number.isFinite(r.amount) || r.amount <= 0) return "Enter an amount above 0, e.g. 25.";
  return null;
}

/** The API fields for a RiskValue. */
export function riskBody(r: RiskValue) {
  if (r.mode === "percent") return { risk_percent: r.percent, risk_amount: null };
  // With a fixed amount the % isn't used, but the API still checks it: never send a stale out-of-range
  // value (e.g. 25 typed in the % box before switching to Fixed $).
  const percent = Number.isFinite(r.percent) ? Math.min(5, Math.max(0.1, r.percent)) : 1;
  return { risk_percent: percent, risk_amount: r.amount };
}

/** "1%" or "$25" for a bot. */
export function riskLabel(bot: Pick<Bot, "risk_percent" | "risk_amount">, currency = "USD") {
  if (!bot.risk_amount) return `${bot.risk_percent}%`;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return `${symbol}${bot.risk_amount}`;
}

export function RiskField({ value, onChange, currency = "USD" }: { value: RiskValue; onChange: (v: RiskValue) => void; currency?: string }) {
  const symbol = currency === "USD" ? "$" : currency;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Risk per trade</span>
        <div role="group" aria-label="Risk per trade as" className="flex rounded-lg bg-black/30 p-0.5 text-[11px]">
          {(["percent", "amount"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={value.mode === m}
              onClick={() => onChange({ ...value, mode: m })}
              className={cn(
                "min-h-7 rounded-md px-2.5 font-medium",
                value.mode === m ? "bg-white/[0.1] text-ivory" : "text-muted-foreground hover:text-ivory",
              )}
            >
              {m === "percent" ? "% of account" : `Fixed ${symbol}`}
            </button>
          ))}
        </div>
      </div>
      {value.mode === "percent" ? (
        <Input
          type="number"
          step="0.1"
          min="0.1"
          max="5"
          aria-label="Risk per trade, % of the account"
          value={value.percent}
          onChange={(e) => onChange({ ...value, percent: Number(e.target.value) })}
        />
      ) : (
        <Input
          type="number"
          step="1"
          min="1"
          aria-label={`Risk per trade, ${currency}`}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: Number(e.target.value) })}
        />
      )}
      {riskError(value) ? (
        <span role="alert" className="text-[11px] text-loss">
          {riskError(value)}
        </span>
      ) : (
      <span className="text-[11px] text-muted-foreground">
        {value.mode === "percent"
          ? "Loss if the stop is hit, as % of equity. 0.5–1% is sensible; hard-capped at 5%."
          : `Each trade loses about ${symbol}${value.amount || 0} if its stop is hit (never more than 5% of the account).`}
      </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The engine's latest verdict on a bot, in plain words

/** What the engine last decided for this bot, and whether that needs attention. */
export function describeCheck(bot: Pick<Bot, "status" | "source" | "timeframe" | "last_check">, tfLabel: string, now = Date.now()) {
  const c = bot.last_check;
  if (bot.status !== "running") return null;
  if (!c) return { text: "Not checked yet. The engine looks at running bots every minute.", tone: "muted" as const, at: null };
  const ageMin = (now - Date.parse(c.at)) / 60_000;
  // Bots are checked every minute; the verdict is re-saved at least every 5 minutes.
  if (ageMin > 15) {
    return { text: `The engine hasn't checked this bot for ${Math.round(ageMin)} minutes. The every-minute schedule may have stopped.`, tone: "warn" as const, at: c.at };
  }
  const r = c.result;
  const map: Array<[RegExp, string, "ok" | "muted" | "warn"]> = [
    [/^waiting for next bar$/, `Waiting for the next ${tfLabel} candle to close.`, "muted"],
    [/^hold$/, "Checked the latest candle: no new trade signal.", "muted"],
    [/^(buy|sell)$/, `Sent a ${r.toUpperCase()} order on the latest candle.`, "ok"],
    [/^closed$/, "Closed its position on the latest candle.", "ok"],
    [/^not enough data$/, "Not enough price history for this market and timeframe yet.", "warn"],
    [/^waiting for MT5 prices$/, "Waiting for prices from the MT5 bridge EA (is it running with candles enabled?).", "warn"],
    [/^alerts only$/, "This script only trades on TradingView alerts.", "muted"],
    [/^waiting for TradingView alerts$/, "Waiting for TradingView alerts.", "muted"],
    [/^kill switch on$/, "The kill switch is on.", "warn"],
    [/^no strategy$/, "This bot has no strategy set.", "warn"],
  ];
  for (const [re, text, tone] of map) if (re.test(r)) return { text, tone, at: c.at };
  if (/^(buy|sell) refused: /.test(r)) return { text: `Wanted to ${r.split(" ")[0]!.toUpperCase()}, but the order was refused: ${r.replace(/^(buy|sell) refused: /, "")}`, tone: "warn" as const, at: c.at };
  if (/^paused/.test(r)) return { text: r.replace(/^paused: /, "Paused: "), tone: "warn" as const, at: c.at };
  if (/^error: /.test(r)) return { text: `Error: ${r.slice(7)}`, tone: "warn" as const, at: c.at };
  return { text: r, tone: "muted" as const, at: c.at };
}
