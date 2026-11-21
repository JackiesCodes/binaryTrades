"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Moon, RefreshCw, SearchX, SlidersHorizontal, Sun, X } from "lucide-react";

import { IndicatorsPanel } from "@/components/markets/indicators-panel";
import { CHART_TYPES, PriceChart, type ChartType, type PriceChartHandle } from "@/components/markets/price-chart";
import { SymbolSearch, type SymbolSearchHandle } from "@/components/markets/symbol-search";
import { TIMEFRAMES, changePercent, formatPrice, isTimeframe, priceDecimals, timeframe, type TimeframeId } from "@/lib/markets/bars";
import { indicatorLabel, sanitizeIndicators, type IndicatorConfig } from "@/lib/markets/indicators";
import { MarketDataError, disposeFeeds, load24hReference, loadCatalog, loadHistory, streamBars, type FeedStatus } from "@/lib/markets/feeds";
import { DEFAULT_SYMBOL, STARTER_SYMBOLS, parseSymbolId, type MarketSymbol } from "@/lib/markets/symbols";
import { PALETTES, paletteVars, type MarketsTheme } from "@/lib/markets/theme";
import { cn } from "@/lib/utils";

const PREFS_KEY = "bt.markets.prefs.v1";

interface Prefs {
  symbol: string;
  tf: TimeframeId;
  theme: MarketsTheme;
  chartType: ChartType;
}

const INDICATORS_KEY = "bt.markets.indicators.v1";

function readIndicators(): IndicatorConfig[] {
  try {
    return sanitizeIndicators(JSON.parse(localStorage.getItem(INDICATORS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function readPrefs(): Prefs {
  const prefs: Prefs = { symbol: DEFAULT_SYMBOL, tf: "1h", theme: "dark", chartType: "candles" };
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"));
  } catch {
    // no saved prefs
  }
  const url = new URLSearchParams(window.location.search);
  if (url.get("symbol")) prefs.symbol = url.get("symbol")!;
  if (url.get("tf")) prefs.tf = url.get("tf") as TimeframeId;
  if (!isTimeframe(prefs.tf)) prefs.tf = "1h";
  if (prefs.theme !== "light") prefs.theme = "dark";
  if (!CHART_TYPES.some((t) => t.id === prefs.chartType)) prefs.chartType = "candles";
  return prefs;
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable
  }
  const url = new URL(window.location.href);
  url.searchParams.set("symbol", p.symbol);
  url.searchParams.set("tf", p.tf);
  window.history.replaceState(window.history.state, "", url);
}

/** A market we can at least try to chart, even before the full catalog arrives. */
function metaFor(id: string, catalog: MarketSymbol[]): MarketSymbol | null {
  const known = catalog.find((s) => s.id === id);
  if (known) return known;
  const p = parseSymbolId(id);
  if (!p) return null;
  return { id, provider: p.provider, code: p.code, name: p.code, group: p.provider === "binance" ? "Crypto" : "Deriv", hasVolume: p.provider === "binance" };
}

const STATUS: Record<FeedStatus, { label: string; dot: string; pulse?: boolean }> = {
  live: { label: "Live", dot: "bg-[var(--mk-up)]", pulse: true },
  connecting: { label: "Connecting…", dot: "bg-[var(--mk-accent)]" },
  reconnecting: { label: "Reconnecting…", dot: "bg-[var(--mk-accent)]", pulse: true },
  "market-closed": { label: "Market closed", dot: "bg-[var(--mk-muted)]" },
  closed: { label: "Offline", dot: "bg-[var(--mk-down)]" },
};

type LoadState = { kind: "loading" } | { kind: "ready"; empty: boolean } | { kind: "error"; notFound: boolean; message: string };

export function MarketsView() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [catalog, setCatalog] = useState<MarketSymbol[]>(STARTER_SYMBOLS);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [status, setStatus] = useState<{ s: FeedStatus; detail?: string }>({ s: "connecting" });
  const [price, setPrice] = useState<number | null>(null);
  const [ref24, setRef24] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([]);
  const [panel, setPanel] = useState<{ edit: string | null } | null>(null);
  useEffect(() => setIndicators(readIndicators()), []);
  const changeIndicators = useCallback((next: IndicatorConfig[]) => {
    setIndicators(next);
    try {
      localStorage.setItem(INDICATORS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: still works for this visit
    }
  }, []);
  const chart = useRef<PriceChartHandle>(null);
  const search = useRef<SymbolSearchHandle>(null);
  const lastPrice = useRef<number | null>(null);

  useEffect(() => setPrefs(readPrefs()), []);
  useEffect(() => {
    if (prefs) writePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    let live = true;
    loadCatalog()
      .then((c) => live && setCatalog(c))
      .finally(() => live && setCatalogLoading(false));
    return () => {
      live = false;
      disposeFeeds();
    };
  }, []);

  const meta = useMemo(() => (prefs ? metaFor(prefs.symbol, catalog) : null), [prefs, catalog]);
  // Before the first price arrives, keep the last known precision rather than guessing from 0.
  const lastDecimals = useRef(2);
  if (price != null || meta?.pipSize) lastDecimals.current = priceDecimals(price ?? 1, meta?.pipSize);
  const decimals = lastDecimals.current;
  const palette = PALETTES[prefs?.theme ?? "dark"];

  // History, then the live stream, for the chosen market and timeframe.
  useEffect(() => {
    if (!prefs) return;
    const { symbol, tf } = prefs;
    let active = true;
    let stop: (() => void) | null = null;
    setLoad({ kind: "loading" });
    setStatus({ s: "connecting" });
    lastPrice.current = null;
    setPrice(null);
    if (!parseSymbolId(symbol)) {
      setLoad({ kind: "error", notFound: true, message: "Symbol not found" });
      return;
    }
    loadHistory(symbol, tf)
      .then((bars) => {
        if (!active) return;
        chart.current?.setBars(bars);
        lastPrice.current = bars.at(-1)?.close ?? null;
        setPrice(lastPrice.current);
        setLoad({ kind: "ready", empty: bars.length === 0 });
        stop = streamBars(symbol, tf, {
          onBar: (bar) => {
            if (!active) return;
            chart.current?.update(bar);
            lastPrice.current = bar.close;
          },
          onStatus: (s, detail) => active && setStatus({ s, detail }),
        });
      })
      .catch((e: unknown) => {
        if (!active) return;
        const notFound = e instanceof MarketDataError && e.code === "NOT_FOUND";
        setLoad({ kind: "error", notFound, message: notFound ? "Symbol not found" : (e as Error).message || "Market data unavailable" });
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [prefs?.symbol, prefs?.tf, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // 24h reference price, refreshed every 5 minutes.
  useEffect(() => {
    if (!prefs) return;
    let active = true;
    setRef24(null);
    const get = () =>
      load24hReference(prefs.symbol)
        .then((r) => active && setRef24(r))
        .catch(() => {});
    get();
    const t = setInterval(get, 300_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [prefs?.symbol, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header price redraws at most 4 times a second, however fast ticks arrive.
  useEffect(() => {
    const t = setInterval(() => setPrice((p) => (p === lastPrice.current ? p : lastPrice.current)), 250);
    return () => clearInterval(t);
  }, []);

  const set = useCallback((patch: Partial<Prefs>) => setPrefs((p) => (p ? { ...p, ...patch } : p)), []);

  // Keyboard: 1–7 timeframes, / search, T theme (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TIMEFRAMES.length) {
        set({ tf: TIMEFRAMES[n - 1]!.id });
        e.preventDefault();
      } else if (e.key === "/") {
        search.current?.focus();
        e.preventDefault();
      } else if (e.key === "i" || e.key === "I") {
        setPanel((p) => (p ? null : { edit: null }));
      } else if (e.key === "t" || e.key === "T") {
        setPrefs((p) => (p ? { ...p, theme: p.theme === "dark" ? "light" : "dark" } : p));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  const change = changePercent(price, ref24);
  const st = STATUS[status.s];
  const tfName = timeframe(prefs?.tf ?? "1h")?.label ?? "";

  return (
    <div
      className="flex h-[calc(100dvh-68px-6rem-env(safe-area-inset-bottom))] min-h-[520px] flex-col overflow-hidden rounded-[18px] border border-[var(--mk-border)] bg-[var(--mk-bg)] text-[var(--mk-text)] lg:h-[calc(100dvh-100px)]"
      style={paletteVars(palette) as React.CSSProperties}
      data-theme={prefs?.theme ?? "dark"}
    >
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-2.5">
        <SymbolSearch ref={search} catalog={catalog} current={meta} loading={catalogLoading} onPick={(s) => set({ symbol: s.id })} />

        <div className="order-3 flex w-full min-w-0 items-baseline gap-2 sm:order-none sm:w-auto" aria-live="off">
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--mk-text)]" aria-label="Current price">
            {formatPrice(price, decimals)}
          </span>
          <span
            className={cn("font-mono text-xs font-semibold tabular-nums", change === null ? "text-[var(--mk-muted)]" : change >= 0 ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]")}
            aria-label="Change over 24 hours"
            title="Change over the last 24 hours"
          >
            {change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
            <span className="ml-1 font-sans font-normal text-[var(--mk-muted)]">24h</span>
          </span>
        </div>

        <div className="order-2 ml-auto flex items-center gap-2 sm:order-none">
          <span className="flex items-center gap-1.5 text-xs text-[var(--mk-muted)]" role="status" title={status.detail ?? st.label}>
            <span className="relative flex h-2 w-2">
              {st.pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", st.dot)} />}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", st.dot)} />
            </span>
            <span className="hidden sm:inline">{st.label}</span>
            <span className="sr-only sm:hidden">{st.label}</span>
          </span>
          <button
            type="button"
            onClick={() => set({ theme: prefs?.theme === "dark" ? "light" : "dark" })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]"
            aria-label={prefs?.theme === "dark" ? "Switch chart to light theme (T)" : "Switch chart to dark theme (T)"}
            title={prefs?.theme === "dark" ? "Light theme (T)" : "Dark theme (T)"}
          >
            {prefs?.theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div role="radiogroup" aria-label="Timeframe" className="scrollbar-none order-4 -mx-1 flex w-full gap-1 overflow-x-auto px-1 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
          {TIMEFRAMES.map((t, i) => {
            const on = prefs?.tf === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={`${t.name} candles (key ${i + 1})`}
                title={`${t.name} · key ${i + 1}`}
                onClick={() => set({ tf: t.id })}
                className={cn(
                  "h-9 min-w-[2.75rem] shrink-0 rounded-lg px-2.5 font-mono text-xs font-semibold transition-colors",
                  on ? "bg-[var(--mk-accent)] text-[var(--mk-bg)]" : "text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-text)]",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar: chart type and indicators */}
      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto border-b border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1.5">
        <div role="radiogroup" aria-label="Chart type" className="flex shrink-0 rounded-lg border border-[var(--mk-border)] p-0.5">
          {CHART_TYPES.map((t) => {
            const on = prefs?.chartType === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t.label}
                title={t.label}
                onClick={() => set({ chartType: t.id })}
                className={cn("h-8 rounded-md px-2.5 text-xs font-semibold", on ? "bg-[var(--mk-raised)] text-[var(--mk-text)]" : "text-[var(--mk-muted)] hover:text-[var(--mk-text)]")}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setPanel((p) => (p ? null : { edit: null }))}
          aria-expanded={Boolean(panel)}
          title="Indicators (I)"
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold",
            panel ? "border-[var(--mk-accent)] text-[var(--mk-text)]" : "border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Indicators
          {indicators.length > 0 && <span className="rounded-full bg-[var(--mk-raised)] px-1.5 font-mono text-[10px] text-[var(--mk-text)]">{indicators.length}</span>}
        </button>
        {indicators.map((c) => (
          <span key={c.id} className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--mk-border)] text-xs text-[var(--mk-text)]">
            <button type="button" className="flex h-full items-center gap-1.5 pl-2 pr-1" onClick={() => setPanel({ edit: c.id })} title={`Edit ${indicatorLabel(c)}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden />
              <span className="font-mono">{indicatorLabel(c)}</span>
            </button>
            <button
              type="button"
              className="flex h-full w-7 items-center justify-center text-[var(--mk-muted)] hover:text-[var(--mk-down)]"
              aria-label={`Remove ${indicatorLabel(c)}`}
              onClick={() => changeIndicators(indicators.filter((x) => x.id !== c.id))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>

      {/* Chart */}
      <div className="relative min-h-0 flex-1">
        {meta && (
          <PriceChart
            ref={chart}
            palette={palette}
            decimals={decimals}
            hasVolume={meta.hasVolume}
            title={`${meta.name} · ${tfName}`}
            chartType={prefs?.chartType ?? "candles"}
            indicators={indicators}
            className="h-full"
          />
        )}
        {panel && <IndicatorsPanel indicators={indicators} onChange={changeIndicators} onClose={() => setPanel(null)} editId={panel.edit} />}
        {load.kind === "loading" && <ChartSkeleton />}
        {load.kind === "ready" && load.empty && (
          <Overlay icon={SearchX} title="No candles yet" body="This market has no price history for this timeframe. Try another timeframe." />
        )}
        {load.kind === "error" && (
          <Overlay
            icon={load.notFound ? SearchX : AlertTriangle}
            title={load.notFound ? "Symbol not found" : "Market data unavailable"}
            body={load.notFound ? "We couldn't find that market. Search for another one above." : load.message.replace(/^Market data unavailable — /, "")}
            action={
              load.notFound ? (
                <button type="button" className="rounded-lg bg-[var(--mk-accent)] px-3 py-2 text-sm font-semibold text-[var(--mk-bg)]" onClick={() => search.current?.focus()}>
                  Search markets
                </button>
              ) : (
                <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--mk-accent)] px-3 py-2 text-sm font-semibold text-[var(--mk-bg)]" onClick={() => setRetry((r) => r + 1)}>
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
              )
            }
          />
        )}
        {load.kind === "ready" && status.s === "market-closed" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center px-3">
            <span className="rounded-full border border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1 text-xs text-[var(--mk-muted)]">{status.detail ?? "Market closed"}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1.5 text-[11px] text-[var(--mk-muted)]">
        <span>Data: {meta?.provider === "deriv" ? "Deriv" : meta?.provider === "binance" ? "Binance" : "—"}</span>
        {meta && !meta.hasVolume && <span>No volume published for this market</span>}
        <span className="hidden lg:inline">Keys: 1–7 timeframe · / search · I indicators · T theme</span>
        <a className="ml-auto underline-offset-2 hover:text-[var(--mk-text)] hover:underline" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          Charts by TradingView
        </a>
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 bg-[var(--mk-panel)] p-4" aria-busy="true" aria-label="Loading price history">
      <div className="h-4 w-56 animate-pulse rounded bg-[var(--mk-raised)]" />
      <div className="flex flex-1 items-end gap-1.5 overflow-hidden">
        {Array.from({ length: 48 }, (_, i) => (
          <div key={i} className="w-full animate-pulse rounded-sm bg-[var(--mk-raised)]" style={{ height: `${30 + ((i * 37) % 50)}%`, animationDelay: `${(i % 8) * 80}ms` }} />
        ))}
      </div>
      <div className="h-3 w-full animate-pulse rounded bg-[var(--mk-raised)]" />
    </div>
  );
}

function Overlay({ icon: Icon, title, body, action }: { icon: typeof SearchX; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[var(--mk-panel)] p-6 text-center" role="alert">
      <Icon className="h-8 w-8 text-[var(--mk-muted)]" aria-hidden />
      <div className="text-base font-semibold text-[var(--mk-text)]">{title}</div>
      <p className="max-w-sm text-sm text-[var(--mk-muted)]">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
