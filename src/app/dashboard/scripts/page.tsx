"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ClipboardPaste, Code2, FileUp, FlaskConical, Rocket, Save, TriangleAlert, Webhook } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { EquityChart } from "@/components/app/equity-chart";
import { AccountKindBadge, EmptyState, Field, MetricsGrid, PageSkeleton, Panel, selectClass } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV, Strip, Switcher, Workspace } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, money, pct, pnlClass, price } from "@/lib/client";
import type { BacktestResult } from "@/lib/strategies/backtest";
import { SCRIPT_REFERENCE, SCRIPT_TEMPLATES, looksLikePine } from "@/lib/strategies/script-templates";
import { DATA_SYMBOLS, TIMEFRAMES, timeframeLabel } from "@/lib/trading/symbols";
import type { PublicBroker } from "@/lib/trading/state";
import type { Bot } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

interface CheckResult {
  inputs: Record<string, number>;
  logs: string[];
  has_on_alert?: boolean;
  has_on_bar?: boolean;
}
type TestResult = CheckResult & BacktestResult & { range: { from: number; to: number; bars: number } };

const RISK_KEYS = new Set(["atr_mult", "rr"]);

export default function ScriptsPage() {
  return (
    <Suspense>
      <ScriptStudio />
    </Suspense>
  );
}

function ScriptStudio() {
  const { state, refresh } = useDashboard();
  const { toast } = useFeedback();
  const search = useSearchParams();
  const editingId = search.get("bot");
  const editing = state?.bots.find((b) => b.id === editingId && b.strategy?.id === "script");
  const scriptBots = state?.bots.filter((b) => b.strategy?.id === "script") ?? [];

  const [code, setCode] = useState(SCRIPT_TEMPLATES[0]!.code);
  const [inputs, setInputs] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, number>>({});
  const [atrMult, setAtrMult] = useState(2);
  const [rr, setRr] = useState(2);
  const [dataSymbol, setDataSymbol] = useState("R_75");
  const [timeframe, setTimeframe] = useState(3600);
  const [busy, setBusy] = useState<"check" | "test" | "deploy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const loadedFor = useRef<string | null>(null);
  const [tab, setTab] = useState<"test" | "deploy">("test");

  // Load the bot being edited once its data arrives.
  useEffect(() => {
    if (!editing || loadedFor.current === editing.id) return;
    loadedFor.current = editing.id;
    const params = editing.strategy?.params ?? {};
    setCode(editing.strategy?.code ?? "");
    setInputs(Object.fromEntries(Object.entries(params).filter(([k]) => !RISK_KEYS.has(k))));
    setValues(Object.fromEntries(Object.entries(params).filter(([k]) => !RISK_KEYS.has(k))));
    setAtrMult(params.atr_mult ?? 2);
    setRr(params.rr ?? 2);
    setDataSymbol(editing.data_symbol);
    setTimeframe(editing.timeframe);
    setCheck(null);
    setTest(null);
    setError(null);
  }, [editing]);

  const isPine = useMemo(() => looksLikePine(code), [code]);
  const params = { ...values, atr_mult: atrMult, rr };

  const applyInputs = (found: Record<string, number>) => {
    setInputs(found);
    // Keep values the user already typed for inputs that still exist.
    setValues((prev) => Object.fromEntries(Object.entries(found).map(([k, v]) => [k, k in prev ? prev[k]! : v])));
  };

  const run = async (kind: "check" | "test") => {
    setBusy(kind);
    setError(null);
    try {
      const body = { code, params, ...(kind === "test" ? { data_symbol: dataSymbol, timeframe } : {}) };
      const res = await api<CheckResult | TestResult>("/api/scripts/test", "POST", body);
      applyInputs(res.inputs);
      setCheck(res);
      setTest(kind === "test" ? (res as TestResult) : null);
      if (kind === "check") toast("Script looks good", "success");
    } catch (e) {
      setError((e as Error).message);
      setTest(null);
    } finally {
      setBusy(null);
    }
  };

  const saveEdits = async () => {
    if (!editing) return;
    setBusy("deploy");
    setError(null);
    try {
      await api(`/api/bots/${editing.id}`, "PATCH", { script: code, strategy_params: params });
      await refresh();
      toast(`${editing.name} updated — the new script runs from the next candle`, "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const loadTemplate = (id: string) => {
    const t = SCRIPT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setCode(t.code);
    setCheck(null);
    setTest(null);
    setError(null);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setCode(text);
        setCheck(null);
        setTest(null);
        setError(null);
      } else toast("The clipboard is empty", "error");
    } catch {
      toast("Your browser blocked clipboard access — long-press in the editor and choose Paste instead.", "error");
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 50_000) return toast("That file is too large for a script (max 50 KB).", "error");
    setCode(await file.text());
    setCheck(null);
    setTest(null);
    setError(null);
  };

  if (!state) return <PageSkeleton />;

  const disabled = busy !== null || isPine || !code.trim();
  const template = SCRIPT_TEMPLATES.find((t) => t.code === code);
  const marketLabel = DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol;

  return (
    <Workspace
      strip={
        <Strip
          icon={Code2}
          title={editing ? `Edit · ${editing.name}` : "Scripts"}
          sub={editing ? "Saving updates the running bot from its next candle" : "Your own JavaScript strategies"}
          action={
            editing ? (
              <Link href="/dashboard/scripts" className="text-xs text-muted-foreground hover:text-profit">
                New script
              </Link>
            ) : undefined
          }
          stats={[
            { label: "Market", value: marketLabel },
            { label: "Timeframe", value: timeframeLabel(timeframe) },
            {
              label: "Last test",
              value: test ? pct(test.metrics.return_percent, 1, true) : "—",
              tone: test ? pnlClass(test.metrics.return_percent) : undefined,
            },
            { label: "Trades", value: test ? String(test.metrics.trades) : "—" },
            { label: "Script bots", value: String(scriptBots.length) },
          ]}
        />
      }
      aside={
        <>
          <Switcher
            value={tab}
            onChange={setTab}
            options={[
              { value: "test", label: "Test" },
              { value: "deploy", label: editing ? "Save" : "Create bot" },
            ]}
          />
          {tab === "test" ? (
            <>
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
                  <Field label="Stop (× ATR)">
                    <Input type="number" step="0.1" min="0.1" value={atrMult} onChange={(e) => setAtrMult(Number(e.target.value))} />
                  </Field>
                  <Field label="Reward : risk" hint="0 = exit on signal">
                    <Input type="number" step="0.5" min="0" value={rr} onChange={(e) => setRr(Number(e.target.value))} />
                  </Field>
                  {Object.keys(inputs).map((k) => (
                    <Field key={k} label={k}>
                      <Input type="number" step="any" value={values[k] ?? inputs[k]} onChange={(e) => setValues({ ...values, [k]: Number(e.target.value) })} />
                    </Field>
                  ))}
                </div>
                {!Object.keys(inputs).length && (
                  <p className="text-[11px] text-muted-foreground">Settings from your script&apos;s input() calls appear here after a check.</p>
                )}
              </FieldBox>
              <div className="grid grid-cols-[auto_1fr] gap-2">
                <Button variant="outline" onClick={() => run("check")} disabled={disabled} className="h-12">
                  {busy === "check" ? "Checking…" : "Check"}
                </Button>
                <Button onClick={() => run("test")} disabled={disabled} className="h-12 text-[15px] font-bold">
                  <FlaskConical /> {busy === "test" ? "Testing on history…" : "Test on history"}
                </Button>
              </div>
            </>
          ) : editing ? (
            <>
              <p className="text-sm text-muted-foreground">
                Saves the code and its settings to <b className="text-ivory">{editing.name}</b>. The bot keeps running and uses the new script from the next
                candle.
              </p>
              <KV
                rows={[
                  ["Market", `${editing.symbol} · ${timeframeLabel(editing.timeframe)}`],
                  ["Status", editing.status === "running" ? "Running" : "Paused", editing.status === "running" ? "text-profit" : "text-gold"],
                  ["Stop / target", `${atrMult} × ATR · ${rr} : 1`],
                ]}
              />
              <Button onClick={saveEdits} disabled={disabled} className="h-12 w-full text-[15px] font-bold">
                <Save /> {busy === "deploy" ? "Saving…" : "Save changes"}
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/dashboard/bots/${editing.id}`}>Open bot</Link>
              </Button>
            </>
          ) : (
            <DeployPanel
              brokers={state.brokers}
              code={code}
              params={params}
              dataSymbol={dataSymbol}
              timeframe={timeframe}
              disabled={disabled}
              onError={setError}
              onBusy={(b) => setBusy(b ? "deploy" : null)}
              busy={busy === "deploy"}
            />
          )}

          <div className="h-px bg-white/[0.06]" />
          <AsideTitle>Your script bots</AsideTitle>
          {scriptBots.length ? (
            <div className="rounded-[14px] bg-black/25 px-3">
              {scriptBots.map((b) => (
                <ScriptBotRow key={b.id} bot={b} broker={state.brokers.find((x) => x.id === b.broker_account_id)} active={b.id === editingId} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No script bots yet.</p>
          )}
          <div className="h-px bg-white/[0.06]" />
          <Reference />
        </>
      }
    >
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold text-ivory">
            <Code2 className="h-4 w-4" /> Script
          </h2>
          {!editing && (
            <select
              aria-label="Start from a template"
              className={cn(selectClass, "h-9 w-auto max-w-[15rem] text-sm")}
              value={template?.id ?? ""}
              onChange={(e) => loadTemplate(e.target.value)}
            >
              <option value="" disabled>
                Start from a template…
              </option>
              {SCRIPT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="ghost" onClick={paste} aria-label="Paste from clipboard">
            <ClipboardPaste /> <span className="hidden sm:inline">Paste</span>
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <label className="cursor-pointer" aria-label="Open a file">
              <FileUp /> <span className="hidden sm:inline">Open file</span>
              <input type="file" accept=".js,.txt,.mjs,text/plain,text/javascript" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
            </label>
          </Button>
        </div>
        {template && !editing && <p className="mb-3 text-xs text-muted-foreground">{template.description}</p>}
        <CodeEditor value={code} onChange={setCode} errorLine={lineOf(error)} />
        {isPine && (
          <div className="mt-3 flex gap-2 rounded-xl bg-amber-400/[0.07] p-3 text-xs leading-relaxed text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This looks like TradingView <b>Pine Script</b>. Pine only runs inside TradingView. To trade it from here, create a{" "}
              <Link href="/dashboard/bots?new=1&tv=1" className="underline">
                TradingView alerts bot
              </Link>{" "}
              and point your alert at it, or rewrite the logic in JavaScript (start from a template).
            </span>
          </div>
        )}
        {error && (
          <pre role="alert" className="mt-3 whitespace-pre-wrap rounded-xl bg-loss/10 px-3 py-2 font-mono text-xs text-loss">
            {error}
          </pre>
        )}
      </Panel>

      {check && <ScriptOutput check={check} test={test} dataSymbol={dataSymbol} timeframe={timeframe} />}
      {/function\s+onAlert\s*\(/.test(code) && <AlertTester code={code} params={params} dataSymbol={dataSymbol} timeframe={timeframe} />}
    </Workspace>
  );
}

function lineOf(error: string | null): number | null {
  const m = error?.match(/^Line (\d+):/);
  return m ? Number(m[1]) : null;
}

function CodeEditor({ value, onChange, errorLine }: { value: string; onChange: (v: string) => void; errorLine: number | null }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
  };

  return (
    <div className="flex overflow-hidden rounded-xl border border-white/10 bg-black/30 focus-within:border-profit/40">
      <div
        ref={gutter}
        aria-hidden
        className="select-none overflow-hidden border-r border-white/5 py-3 pl-2 pr-2 text-right font-mono text-xs leading-5 text-muted-foreground/60"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cn(errorLine === i + 1 && "rounded bg-loss/30 text-loss")}>
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Strategy script"
        wrap="off"
        className="scrollbar-thin h-[22rem] min-w-0 flex-1 resize-y bg-transparent p-3 font-mono text-base leading-5 text-foreground outline-none sm:h-[26rem] sm:text-xs"
      />
    </div>
  );
}

function ScriptOutput({ check, test, dataSymbol, timeframe }: { check: CheckResult; test: TestResult | null; dataSymbol: string; timeframe: number }) {
  const label = DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol;
  return (
    <Panel title={test ? `Test results · ${label} ${timeframeLabel(timeframe)}` : "Check results"}>
      {test ? (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">
            {new Date(test.range.from * 1000).toLocaleDateString()} → {new Date(test.range.to * 1000).toLocaleDateString()} · {test.range.bars} candles ·
            $10,000 start · costs included
          </div>
          <EquityChart points={test.equity.map((p) => ({ x: p.epoch * 1000, y: p.equity }))} height={240} />
          <MetricsGrid m={test.metrics} />
          {test.trades.length ? (
            <div className="scrollbar-thin max-h-64 overflow-auto">
              <table className="w-full min-w-[480px] text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Opened</th>
                    <th className="px-2 py-1.5 font-medium">Side</th>
                    <th className="px-2 py-1.5 font-medium">Entry → Exit</th>
                    <th className="px-2 py-1.5 font-medium">Exit</th>
                    <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...test.trades].reverse().map((t, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1.5">{new Date(t.entry_epoch * 1000).toLocaleString()}</td>
                      <td className={cn("px-2 py-1.5", t.side === "buy" ? "text-profit" : "text-loss")}>{t.side.toUpperCase()}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {price(t.entry)} → {price(t.exit)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{t.reason}</td>
                      <td className={cn("px-2 py-1.5 text-right font-mono", pnlClass(t.pnl))}>{money(t.pnl, "USD", true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>The script made no trades in this period.</EmptyState>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            A good backtest is not a promise. Results can fade live, so run a new script on a demo account before giving it real money.
          </p>
        </div>
      ) : (
        <p className="text-sm text-profit">The script runs without errors.</p>
      )}
      {check.logs.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs text-muted-foreground">Output</div>
          <pre className="scrollbar-thin max-h-40 overflow-auto rounded-xl bg-black/30 p-3 font-mono text-xs text-muted-foreground">{check.logs.join("\n")}</pre>
        </div>
      )}
    </Panel>
  );
}

function DeployPanel({
  brokers,
  code,
  params,
  dataSymbol,
  timeframe,
  disabled,
  busy,
  onBusy,
  onError,
}: {
  brokers: PublicBroker[];
  code: string;
  params: Record<string, number>;
  dataSymbol: string;
  timeframe: number;
  disabled: boolean;
  busy: boolean;
  onBusy: (b: boolean) => void;
  onError: (e: string | null) => void;
}) {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const router = useRouter();
  const [name, setName] = useState("");
  const [brokerId, setBrokerId] = useState(brokers.find((b) => b.is_demo)?.id ?? brokers[0]?.id ?? "");
  const broker = brokers.find((b) => b.id === brokerId);
  const [mt5Symbol, setMt5Symbol] = useState("");
  const [mt5Edited, setMt5Edited] = useState(false);
  const [priceSource, setPriceSource] = useState<"broker" | "deriv">("broker");
  const [risk, setRisk] = useState(1);
  const [multiplier, setMultiplier] = useState(100);
  const [startNow, setStartNow] = useState(true);
  const isMt5 = broker?.kind === "mt5";
  const killOn = state?.settings.kill_switch ?? false;

  // Suggest the MT5 name of the chosen market (EURUSD for frxEURUSD) until the user types their own.
  useEffect(() => {
    if (!mt5Edited) setMt5Symbol(/^(frx|cry)/.test(dataSymbol) ? dataSymbol.slice(3) : "");
  }, [dataSymbol, mt5Edited]);

  if (!brokers.length) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Connect a broker account first — every bot trades on one of your accounts.</p>
        <Button asChild className="w-full">
          <Link href="/dashboard/brokers?connect=1">Connect a broker account</Link>
        </Button>
      </div>
    );
  }

  const deploy = async () => {
    if (
      startNow &&
      broker &&
      !broker.is_demo &&
      !(await confirm({
        title: "Start this script on a REAL-money account?",
        description: `${broker.label} trades real money. Test new scripts on a demo account first.`,
        confirmLabel: "Start with real money",
        danger: true,
      }))
    ) {
      return;
    }
    onBusy(true);
    onError(null);
    try {
      const marketLabel = DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol;
      const bot = await api<Bot>("/api/bots", "POST", {
        name: name.trim() || `Script · ${marketLabel} ${timeframeLabel(timeframe)}`,
        source: "builtin",
        strategy_id: "script",
        script: code,
        strategy_params: params,
        broker_account_id: brokerId,
        symbol: isMt5 ? mt5Symbol.trim() : dataSymbol,
        data_symbol: dataSymbol,
        timeframe,
        risk_percent: risk,
        deriv_multiplier: multiplier,
        price_source: isMt5 ? priceSource : "deriv",
        start: startNow,
      });
      await refresh();
      toast(bot.status === "running" ? `${bot.name} is running` : `${bot.name} created (paused)`, "success");
      router.push("/dashboard/bots");
    } catch (e) {
      onError((e as Error).message);
    } finally {
      onBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <FieldBox>
        <Field label="Bot name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vol 75 EMA cross" maxLength={60} />
        </Field>
        <Field label="Account">
          <div className="flex items-center gap-2">
            <select className={selectClass} value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} · {b.is_demo ? "Demo" : "Real"}
                </option>
              ))}
            </select>
            <AccountKindBadge broker={broker} />
          </div>
        </Field>
        {isMt5 && (
          <Field
            label="Price feed"
            hint={
              priceSource === "broker"
                ? "The script reads this MT5 account's own candles (needs bridge EA v2). Tests on the left use Deriv's history."
                : "The script reads Deriv's candles for the market chosen on the left."
            }
          >
            <select className={selectClass} value={priceSource} onChange={(e) => setPriceSource(e.target.value as "broker" | "deriv")}>
              <option value="broker">MT5 broker prices (recommended)</option>
              <option value="deriv">Deriv market data</option>
            </select>
          </Field>
        )}
        {isMt5 && (
          <Field label="MT5 symbol" hint="Exactly as Market Watch shows it, e.g. EURUSDm.">
            <Input
              value={mt5Symbol}
              placeholder="e.g. EURUSDm"
              onChange={(e) => {
                setMt5Symbol(e.target.value);
                setMt5Edited(true);
              }}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Risk per trade %">
            <Input type="number" step="0.1" min="0.1" max="5" value={risk} onChange={(e) => setRisk(Number(e.target.value))} />
          </Field>
          {!isMt5 && (
            <Field label="Multiplier">
              <Input type="number" step="1" min="1" value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} />
            </Field>
          )}
        </div>
      </FieldBox>
        <p className="text-xs text-muted-foreground">
          Trades {isMt5 ? mt5Symbol || "the MT5 symbol" : DATA_SYMBOLS.find((d) => d.value === dataSymbol)?.label ?? dataSymbol} on{" "}
          {timeframeLabel(timeframe)} candles, the market and timeframe from the Test tab. Stops come from your script or the stop setting there.
          If the script has onAlert, find its TradingView webhook on the bot&apos;s page.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} className="h-4 w-4 accent-[#85BB65]" />
          Start trading right away
        </label>
        {startNow && killOn && <p className="text-xs text-amber-300">The kill switch is on, so the bot will be created paused.</p>}
        <Button onClick={deploy} disabled={disabled || !brokerId || (isMt5 && !mt5Symbol.trim())} className="h-12 w-full text-[15px] font-bold">
          <Rocket /> {busy ? "Creating…" : startNow ? "Create and start bot" : "Create bot (paused)"}
        </Button>
    </div>
  );
}

function Reference() {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <AsideTitle icon={BookOpen}>How scripts work</AsideTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Scripts are JavaScript. Define <code className="text-foreground">onBar(i)</code>; it runs once for every closed candle and returns{" "}
        <code className="text-profit">&quot;buy&quot;</code>, <code className="text-loss">&quot;sell&quot;</code>,{" "}
        <code className="text-foreground">&quot;close&quot;</code>, or nothing to hold. Every trade gets a stop of ATR(14) × your stop setting, and
        Risk Guard sizes it.
      </p>
      {open && (
        <dl className="space-y-2 text-xs">
          {SCRIPT_REFERENCE.map((r) => (
            <div key={r.name}>
              <dt className="font-mono text-foreground">{r.name}</dt>
              <dd className="text-muted-foreground">{r.detail}</dd>
            </div>
          ))}
          <div className="rounded-lg bg-black/25 p-2 text-muted-foreground">
            Scripts run in a locked sandbox: no internet, files or keys, 3 seconds and 64 MB per run.
          </div>
        </dl>
      )}
    </section>
  );
}

function ScriptBotRow({ bot, broker, active }: { bot: Bot; broker: PublicBroker | undefined; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ivory">{bot.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {bot.symbol} · {timeframeLabel(bot.timeframe)} ·{" "}
          <span className={broker && !broker.is_demo ? "font-semibold text-gold" : undefined}>{broker ? (broker.is_demo ? "Demo" : "Real") : "No account"}</span> ·{" "}
          <span className={bot.status === "running" ? "text-profit" : "text-gold"}>{bot.status === "running" ? "Running" : "Paused"}</span>
        </div>
      </div>
      <Button size="sm" variant={active ? "default" : "outline"} asChild>
        <Link href={`/dashboard/scripts?bot=${bot.id}`}>Edit</Link>
      </Button>
    </div>
  );
}

function AlertTester({ code, params, dataSymbol, timeframe }: { code: string; params: Record<string, number>; dataSymbol: string; timeframe: number }) {
  const [alertJson, setAlertJson] = useState('{ "action": "buy", "price": 0 }');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    logs: string[];
    alert_decision: { action: string | null; stop: number | null; target: number | null; last_close: number | null; last_time: number | null };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      let alert: Record<string, unknown>;
      try {
        alert = JSON.parse(alertJson) as Record<string, unknown>;
      } catch {
        throw new Error("The alert must be valid JSON, like { \"action\": \"buy\" }.");
      }
      setResult(await api("/api/scripts/test", "POST", { code, params, data_symbol: dataSymbol, timeframe, alert }));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const d = result?.alert_decision;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Webhook className="h-4 w-4" /> Test a TradingView alert
        </span>
      }
    >
      <p className="text-sm text-muted-foreground">
        Sends a sample alert through your <code className="text-foreground">onAlert(alert, i)</code> on the latest {timeframeLabel(timeframe)} candles. Add
        any fields your TradingView alert will send.
      </p>
      <textarea
        value={alertJson}
        onChange={(e) => setAlertJson(e.target.value)}
        spellCheck={false}
        rows={3}
        aria-label="Sample alert JSON"
        className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-base text-foreground outline-none focus:border-profit/40 sm:text-xs"
      />
      <Button variant="outline" onClick={run} disabled={busy} className="mt-2">
        {busy ? "Running…" : "Run onAlert"}
      </Button>
      {error && <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-loss/10 px-3 py-2 font-mono text-xs text-loss">{error}</pre>}
      {d && (
        <div className="mt-3 rounded-xl bg-white/[0.03] p-3 text-sm">
          {d.action ? (
            <span>
              Decision:{" "}
              <b className={d.action === "buy" ? "text-profit" : d.action === "sell" ? "text-loss" : "text-foreground"}>{d.action.toUpperCase()}</b>
              {d.stop !== null && <> · stop {price(d.stop)}</>}
              {d.target !== null && <> · target {price(d.target)}</>}
            </span>
          ) : (
            <span className="text-muted-foreground">Decision: ignore this alert</span>
          )}
          {d.last_close !== null && (
            <span className="block text-xs text-muted-foreground">
              Latest close {price(d.last_close)}
              {d.last_time ? ` at ${new Date(d.last_time * 1000).toLocaleString()}` : ""}
            </span>
          )}
          {result.logs.length > 0 && <pre className="mt-2 font-mono text-xs text-muted-foreground">{result.logs.join("\n")}</pre>}
        </div>
      )}
    </Panel>
  );
}
