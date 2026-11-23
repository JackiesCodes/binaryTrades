"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpDown, Bell, Zap, List, Moon, RefreshCw, SearchX, SlidersHorizontal, Star, Sun, Trash2, X } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";

import { IndicatorsPanel } from "@/components/markets/indicators-panel";
import { CHART_TYPES, PriceChart, type ChartType, type PriceChartHandle } from "@/components/markets/price-chart";
import { SymbolSearch, type SymbolSearchHandle } from "@/components/markets/symbol-search";
import { Watchlist } from "@/components/markets/watchlist";
import { AlertsPanel } from "@/components/markets/alerts-panel";
import { TradePanel, type TradeBot } from "@/components/markets/trade-panel";
import { useMarketsState, type SyncStatus } from "@/components/markets/use-markets-state";
import { activeAlerts, alertHit, type PriceAlert } from "@/lib/markets/alerts";
import { MAX_WATCHLIST } from "@/lib/markets/state";
import { tradesForMarket } from "@/lib/markets/trade-marks";
import type { Trade } from "@/lib/trading/types";
import { DRAW_TOOLS, MAX_DRAWINGS_PER_SYMBOL, type DrawTool, type Drawing } from "@/lib/markets/drawings";
import { TIMEFRAMES, changePercent, formatPrice, isTimeframe, priceDecimals, timeframe, type TimeframeId } from "@/lib/markets/bars";
import { indicatorLabel, type IndicatorConfig } from "@/lib/markets/indicators";
import { MarketDataError, disposeFeeds, load24hReference, loadCatalog, loadHistory, streamBars, watchQuotes, type FeedStatus } from "@/lib/markets/feeds";
import { DEFAULT_SYMBOL, STARTER_SYMBOLS, parseSymbolId, type MarketSymbol } from "@/lib/markets/symbols";
import { PALETTES, paletteVars, type MarketsTheme } from "@/lib/markets/theme";
import { cn } from "@/lib/utils";

const PREFS_KEY = "bt.markets.prefs.v1";

interface Prefs {
  symbol: string;
  tf: TimeframeId;
  theme: MarketsTheme;
  chartType: ChartType;
  /** Desktop: the watchlist panel is open. */
  watchOpen: boolean;
  /** Show the user's trades on the chart. */
  showTrades: boolean;
}

function readPrefs(): Prefs {
  const prefs: Prefs = { symbol: DEFAULT_SYMBOL, tf: "1h", theme: "dark", chartType: "candles", watchOpen: true, showTrades: true };
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
  prefs.watchOpen = prefs.watchOpen !== false;
  prefs.showTrades = prefs.showTrades !== false;
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
  // Watchlist, indicators, drawings and alerts: saved to the account (and this browser).
  const { doc, status: sync, update, refusal, clearRefusal } = useMarketsState();
  const { state, view } = useDashboard();
  const indicators = doc?.indicators ?? NO_INDICATORS;
  const watchlist = doc?.watchlist ?? NO_IDS;
  const alerts = doc?.alerts ?? NO_ALERTS;
  const changeIndicators = useCallback((next: IndicatorConfig[]) => update("indicators", next), [update]);
  const changeWatchlist = useCallback((next: string[]) => update("watchlist", next.slice(0, MAX_WATCHLIST)), [update]);
  const changeAlerts = useCallback((next: PriceAlert[] | ((prev: PriceAlert[]) => PriceAlert[])) => update("alerts", next), [update]);
  const [panel, setPanel] = useState<{ edit: string | null } | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const { confirm, toast } = useFeedback();
  const [tool, setTool] = useState<DrawTool | null>(null);
  const [sheet, setSheet] = useState(false);
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

  const symbolId = prefs?.symbol ?? "";
  const drawings = useMemo(() => doc?.drawings[symbolId] ?? NO_DRAWINGS, [doc, symbolId]);
  const changeDrawings = useCallback(
    (next: Drawing[]) =>
      update("drawings", (store) => {
        const out = { ...store };
        if (next.length) out[symbolId] = next.slice(-MAX_DRAWINGS_PER_SYMBOL);
        else delete out[symbolId];
        return out;
      }),
    [symbolId, update],
  );

  // --- price alerts: checked against live prices while this page is open ---
  const nameOf = useCallback((id: string) => catalog.find((c) => c.id === id)?.name ?? parseSymbolId(id)?.code ?? id, [catalog]);
  const waiting = useMemo(() => activeAlerts(alerts), [alerts]);
  // Your trades on this market (for the account type picked in the top bar), drawn on the chart.
  const marketTrades = useMemo(
    () => (state && meta?.provider === "deriv" ? tradesForMarket([...state.open_trades, ...state.closed_trades], meta.code, view) : NO_TRADES),
    [state, meta, view],
  );
  // Bots that trade this market (any account): the Trade panel places orders through them.
  const tradeBots = useMemo<TradeBot[]>(() => {
    if (!state || meta?.provider !== "deriv") return [];
    return state.bots.flatMap((b) => {
      const broker = state.brokers.find((x) => x.id === b.broker_account_id);
      return b.data_symbol === meta.code && broker ? [{ bot: b, accountLabel: broker.label, isDemo: broker.is_demo, currency: broker.currency }] : [];
    });
  }, [state, meta]);
  useEffect(() => setTradeOpen(false), [symbolId]);
  // One panel at a time: opening Indicators or Alerts closes the Trade panel.
  useEffect(() => {
    if (panel || alertsOpen) setTradeOpen(false);
  }, [panel, alertsOpen]);
  // Bots an alert on this market may trade with: demo accounts, same Deriv market.
  const alertBots = useMemo(() => {
    if (!state || meta?.provider !== "deriv") return [];
    const demo = new Set(state.brokers.filter((b) => b.is_demo).map((b) => b.id));
    return state.bots
      .filter((b) => b.data_symbol === meta.code && b.broker_account_id && demo.has(b.broker_account_id))
      .map((b) => ({ id: b.id, name: b.name, running: b.status === "running" }));
  }, [state, meta]);
  useEffect(() => {
    if (!refusal) return;
    toast(refusal, "error", 8000);
    clearRefusal();
  }, [refusal, clearRefusal, toast]);
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const firedIds = useRef(new Set<string>());
  const checkAlerts = useCallback(
    (id: string, price: number | null) => {
      if (price === null) return;
      // Alerts that trade are left to the server (it places the trade within a minute).
      const hits = waitingRef.current.filter((a) => !a.trade && a.symbol === id && !firedIds.current.has(a.id) && alertHit(a, price));
      if (!hits.length) return;
      const now = new Date().toISOString();
      for (const a of hits) {
        firedIds.current.add(a.id);
        const d = priceDecimals(price, catalog.find((c) => c.id === id)?.pipSize);
        const text = `${nameOf(id)} is ${a.op} ${formatPrice(a.price, d)} (now ${formatPrice(price, d)})`;
        toast(`Price alert: ${text}`, "success", 12_000);
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("binaryTrades price alert", { body: text, tag: a.id });
        } catch {
          // some mobile browsers only allow notifications from a service worker
        }
      }
      changeAlerts((prev) => prev.map((x) => (hits.some((h) => h.id === x.id) ? { ...x, triggered_at: now, triggered_price: price } : x)));
    },
    [catalog, changeAlerts, nameOf, toast],
  );
  // Alerts the server fired (every minute, also with the site closed) show up here too.
  const seenWaiting = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!doc) return;
    const now = new Set(waiting.map((a) => a.id));
    const before = seenWaiting.current;
    seenWaiting.current = now;
    if (!before) return;
    for (const a of alerts) {
      if (a.triggered_at && before.has(a.id) && !firedIds.current.has(a.id)) {
        firedIds.current.add(a.id);
        const d = priceDecimals(a.triggered_price ?? a.price, catalog.find((c) => c.id === a.symbol)?.pipSize);
        toast(
          `Price alert: ${nameOf(a.symbol)} went ${a.op} ${formatPrice(a.price, d)}${a.triggered_price != null ? ` (reached ${formatPrice(a.triggered_price, d)})` : ""}${a.trade_result ? ` · ${a.trade_result}` : ""}`,
          a.trade_result?.startsWith("Not placed") ? "error" : "success",
          12_000,
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);
  const checkRef = useRef(checkAlerts);
  checkRef.current = checkAlerts;
  const alertSymbols = useMemo(() => [...new Set(waiting.map((a) => a.symbol))].sort().join(","), [waiting]);
  useEffect(() => {
    if (!alertSymbols) return;
    return watchQuotes(alertSymbols.split(","), (id, q) => checkRef.current(id, q.price));
  }, [alertSymbols]);
  useEffect(() => setTool(null), [symbolId]);
  const watched = watchlist.includes(symbolId);
  const pick = useCallback((id: string) => {
    setPrefs((p) => (p ? { ...p, symbol: id } : p));
    setSheet(false);
  }, []);

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
            checkRef.current(symbol, bar.close);
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
      } else if (e.key === "w" || e.key === "W") {
        if (window.matchMedia("(min-width: 1024px)").matches) setPrefs((p) => (p ? { ...p, watchOpen: !p.watchOpen } : p));
        else setSheet((v) => !v);
      } else if (e.key === "i" || e.key === "I") {
        setAlertsOpen(false);
        setPanel((p) => (p ? null : { edit: null }));
      } else if (e.key === "a" || e.key === "A") {
        setPanel(null);
        setAlertsOpen((v) => !v);
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
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
          <SymbolSearch ref={search} catalog={catalog} current={meta} loading={catalogLoading} onPick={(s) => set({ symbol: s.id })} />
          <button
            type="button"
            onClick={() => changeWatchlist(watched ? watchlist.filter((x) => x !== symbolId) : [...watchlist, symbolId])}
            disabled={!meta || (!watched && watchlist.length >= MAX_WATCHLIST)}
            aria-pressed={watched}
            aria-label={watched ? `Remove ${meta?.name ?? "market"} from the watchlist` : `Add ${meta?.name ?? "market"} to the watchlist`}
            title={watched ? "In your watchlist" : "Add to watchlist"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)] disabled:opacity-40"
          >
            <Star className={cn("h-4 w-4", watched && "fill-[var(--mk-accent)] text-[var(--mk-accent)]")} />
          </button>
        </div>

        <div className="order-3 flex w-full min-w-0 items-baseline gap-2 sm:order-none sm:w-auto" aria-live="off">
          <span className="font-mono text-lg font-semibold tabular-nums text-[var(--mk-text)]" aria-label="Current price">
            {formatPrice(price, decimals)}
          </span>
          <span
            className={cn(
              "font-mono text-xs font-semibold tabular-nums",
              change === null ? "text-[var(--mk-muted)]" : change >= 0 ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]",
            )}
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
            onClick={() => {
              if (window.matchMedia("(min-width: 1024px)").matches) set({ watchOpen: !prefs?.watchOpen });
              else setSheet((v) => !v);
            }}
            aria-label="Watchlist (W)"
            aria-expanded={sheet || undefined}
            title="Watchlist (W)"
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
              prefs?.watchOpen ? "border-[var(--mk-border)] lg:border-[var(--mk-accent)] lg:text-[var(--mk-text)]" : "border-[var(--mk-border)]",
            )}
          >
            <List className="h-4 w-4" />
          </button>
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

        <div role="radiogroup" aria-label="Timeframe" className="scrollbar-none hidden gap-1 overflow-x-auto sm:flex">
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
        {/* Phones: timeframe and chart style as compact dropdowns, on this one row. */}
        <label className="shrink-0 sm:hidden">
          <span className="sr-only">Timeframe</span>
          <select value={prefs?.tf ?? "1h"} onChange={(e) => set({ tf: e.target.value as TimeframeId })} className={mobileSelect} style={CHEVRON}>
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="shrink-0 sm:hidden">
          <span className="sr-only">Chart type</span>
          <select
            value={prefs?.chartType ?? "candles"}
            onChange={(e) => set({ chartType: e.target.value as ChartType })}
            className={mobileSelect}
            style={CHEVRON}
          >
            {CHART_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.short}
              </option>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Chart type" className="hidden shrink-0 rounded-lg border border-[var(--mk-border)] p-0.5 sm:flex">
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
                className={cn(
                  "h-8 rounded-md px-2.5 text-xs font-semibold",
                  on ? "bg-[var(--mk-raised)] text-[var(--mk-text)]" : "text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
                )}
              >
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Drawing tools" className="flex shrink-0 items-center rounded-lg border border-[var(--mk-border)] p-0.5">
          {DRAW_TOOLS.map((t) => {
            const on = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                aria-label={`${t.label}${on ? " (Esc to cancel)" : ""}`}
                title={t.label}
                onClick={() => setTool(on ? null : t.id)}
                className={cn(
                  "inline-flex h-8 w-9 items-center justify-center rounded-md max-lg:h-10 max-lg:w-10",
                  on ? "bg-[var(--mk-accent)] text-[var(--mk-bg)]" : "text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
                )}
              >
                <ToolIcon tool={t.id} />
              </button>
            );
          })}
          {drawings.length > 0 && (
            <button
              type="button"
              aria-label={`Remove all ${drawings.length} drawings on this market`}
              title="Remove all drawings on this market"
              onClick={async () => {
                const ok = await confirm({
                  title: "Remove all drawings?",
                  description: `Removes the ${drawings.length} drawing${drawings.length === 1 ? "" : "s"} on ${meta?.name ?? "this market"}. Other markets keep theirs.`,
                  confirmLabel: "Remove drawings",
                  danger: true,
                });
                if (ok) changeDrawings([]);
              }}
              className="inline-flex h-8 w-9 items-center justify-center rounded-md max-lg:h-10 max-lg:w-10 text-[var(--mk-muted)] hover:text-[var(--mk-down)]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setAlertsOpen(false);
            setPanel((p) => (p ? null : { edit: null }));
          }}
          aria-expanded={Boolean(panel)}
          title="Indicators (I)"
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold",
            panel ? "border-[var(--mk-accent)] text-[var(--mk-text)]" : "border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Indicators
          {indicators.length > 0 && (
            <span className="rounded-full bg-[var(--mk-raised)] px-1.5 font-mono text-[10px] text-[var(--mk-text)]">{indicators.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setPanel(null);
            setAlertsOpen((v) => !v);
          }}
          aria-expanded={alertsOpen}
          title="Price alerts (A)"
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold",
            alertsOpen ? "border-[var(--mk-accent)] text-[var(--mk-text)]" : "border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
          )}
        >
          <Bell className="h-4 w-4" aria-hidden />
          Alerts
          {waiting.length > 0 && (
            <span className="rounded-full bg-[var(--mk-raised)] px-1.5 font-mono text-[10px] text-[var(--mk-text)]">{waiting.length}</span>
          )}
        </button>
        {tradeBots.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setPanel(null);
              setAlertsOpen(false);
              setTradeOpen((v) => !v);
            }}
            aria-expanded={tradeOpen}
            title="Place a trade through one of your bots on this market"
            className={cn(
              // Desktop only: trading from the chart isn't offered on phones and small tablets.
              "hidden h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold lg:inline-flex",
              tradeOpen ? "border-[var(--mk-accent)] text-[var(--mk-text)]" : "border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
            )}
          >
            <Zap className="h-4 w-4" aria-hidden />
            Trade
          </button>
        )}
        {marketTrades.length > 0 && (
          <button
            type="button"
            onClick={() => set({ showTrades: !prefs?.showTrades })}
            aria-pressed={Boolean(prefs?.showTrades)}
            title={`Your ${view} trades on this market: arrows where they opened, results where they closed, lines for open ones`}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold",
              prefs?.showTrades
                ? "border-[var(--mk-accent)] text-[var(--mk-text)]"
                : "border-[var(--mk-border)] text-[var(--mk-muted)] hover:text-[var(--mk-text)]",
            )}
          >
            <ArrowUpDown className="h-4 w-4" aria-hidden />
            Trades
            <span className="rounded-full bg-[var(--mk-raised)] px-1.5 font-mono text-[10px] text-[var(--mk-text)]">{marketTrades.length}</span>
          </button>
        )}
        {indicators.map((c) => (
          <span key={c.id} className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--mk-border)] text-xs text-[var(--mk-text)]">
            <button
              type="button"
              className="flex h-full items-center gap-1.5 pl-2 pr-1"
              onClick={() => setPanel({ edit: c.id })}
              title={`Edit ${indicatorLabel(c)}`}
            >
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

      <div className="relative flex min-h-0 flex-1">
        {/* Chart */}
        <div className="relative min-h-0 min-w-0 flex-1">
          {meta && (
            <PriceChart
              ref={chart}
              palette={palette}
              decimals={decimals}
              hasVolume={meta.hasVolume}
              title={`${meta.name} · ${tfName}`}
              chartType={prefs?.chartType ?? "candles"}
              indicators={indicators}
              timeframe={timeframe(prefs?.tf ?? "1h")?.seconds ?? 3600}
              drawings={drawings}
              onDrawingsChange={changeDrawings}
              tool={tool}
              onToolDone={() => setTool(null)}
              alertLines={waiting.filter((a) => a.symbol === symbolId)}
              trades={prefs?.showTrades ? marketTrades : NO_TRADES}
              className="h-full"
            />
          )}
          {panel && <IndicatorsPanel indicators={indicators} onChange={changeIndicators} onClose={() => setPanel(null)} editId={panel.edit} />}
          {/* Phones: Trade as a floating button on the chart (the toolbar one is off-screen there). */}
          {tradeBots.length > 0 && !tradeOpen && load.kind === "ready" && (
            <button
              type="button"
              onClick={() => {
                setPanel(null);
                setAlertsOpen(false);
                setTradeOpen(true);
              }}
              className="absolute bottom-9 right-[86px] z-20 inline-flex h-11 items-center gap-1.5 rounded-full bg-[var(--mk-accent)] px-4 text-sm font-bold text-[var(--mk-bg)] shadow-glass lg:hidden"
            >
              <Zap className="h-4 w-4" aria-hidden />
              Trade
            </button>
          )}
          {tradeOpen && meta && (
            <TradePanel
              bots={tradeBots}
              marketName={meta.name}
              price={price}
              decimals={decimals}
              getBars={() => chart.current?.bars() ?? []}
              onClose={() => setTradeOpen(false)}
            />
          )}
          {alertsOpen && (
            <AlertsPanel
              alerts={alerts}
              onChange={changeAlerts}
              onClose={() => setAlertsOpen(false)}
              current={meta}
              price={price}
              decimals={decimals}
              nameOf={nameOf}
              onPick={pick}
              bots={alertBots}
              botName={(id) => state?.bots.find((b) => b.id === id)?.name ?? "a deleted bot"}
            />
          )}
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
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--mk-accent)] px-3 py-2 text-sm font-semibold text-[var(--mk-bg)]"
                    onClick={() => search.current?.focus()}
                  >
                    Search markets
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--mk-accent)] px-3 py-2 text-sm font-semibold text-[var(--mk-bg)]"
                    onClick={() => setRetry((r) => r + 1)}
                  >
                    <RefreshCw className="h-4 w-4" /> Try again
                  </button>
                )
              }
            />
          )}
          {load.kind === "ready" && status.s === "market-closed" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center px-3">
              <span className="rounded-full border border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1 text-xs text-[var(--mk-muted)]">
                {status.detail ?? "Market closed"}
              </span>
            </div>
          )}
        </div>

        {/* Watchlist: a side panel on desktop, a bottom sheet on phones */}
        {prefs?.watchOpen && (
          <aside className="hidden w-[272px] shrink-0 flex-col border-l border-[var(--mk-border)] bg-[var(--mk-panel)] lg:flex" aria-label="Watchlist">
            <div className="flex items-center justify-between px-3 pt-2.5">
              <h2 className="text-sm font-semibold text-[var(--mk-text)]">Watchlist</h2>
              <button
                type="button"
                onClick={() => set({ watchOpen: false })}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-text)]"
                aria-label="Hide watchlist"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <Watchlist
              ids={watchlist}
              catalog={catalog}
              catalogLoading={catalogLoading}
              currentId={symbolId}
              onPick={pick}
              onAdd={(id) => changeWatchlist([...watchlist, id])}
              onRemove={(id) => changeWatchlist(watchlist.filter((x) => x !== id))}
            />
          </aside>
        )}
        {sheet && (
          <WatchlistSheet onClose={() => setSheet(false)}>
            <Watchlist
              ids={watchlist}
              catalog={catalog}
              catalogLoading={catalogLoading}
              currentId={symbolId}
              onPick={pick}
              onAdd={(id) => changeWatchlist([...watchlist, id])}
              onRemove={(id) => changeWatchlist(watchlist.filter((x) => x !== id))}
              touch
            />
          </WatchlistSheet>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--mk-border)] bg-[var(--mk-panel)] px-3 py-1.5 text-[11px] text-[var(--mk-muted)]">
        <span>Data: {meta?.provider === "deriv" ? "Deriv" : meta?.provider === "binance" ? "Binance" : "—"}</span>
        <SyncNote status={sync} />
        {meta && !meta.hasVolume && <span>No volume published for this market</span>}
        <span className="hidden lg:inline">
          Keys: 1–7 timeframe · / search · I indicators · A alerts · W watchlist · T theme · Esc cancel drawing · Del delete drawing
        </span>
        <a
          className="ml-auto inline-flex items-center underline-offset-2 max-lg:-my-3 max-lg:min-h-10 hover:text-[var(--mk-text)] hover:underline"
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
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
          <div
            key={i}
            className="w-full animate-pulse rounded-sm bg-[var(--mk-raised)]"
            style={{ height: `${30 + ((i * 37) % 50)}%`, animationDelay: `${(i % 8) * 80}ms` }}
          />
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

function WatchlistSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end lg:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close watchlist" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Watchlist"
        className="relative flex max-h-[80%] min-h-[50%] flex-col rounded-t-2xl border-t border-[var(--mk-border)] bg-[var(--mk-panel)] shadow-glass"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--mk-border)]" aria-hidden />
        <div className="flex items-center justify-between px-3 pt-1">
          <h2 className="text-sm font-semibold text-[var(--mk-text)]">Watchlist</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)]"
            aria-label="Close watchlist"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Small original icons for the drawing tools. */
function ToolIcon({ tool }: { tool: DrawTool }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    "aria-hidden": true,
  };
  if (tool === "trend")
    return (
      <svg {...common}>
        <line x1="3" y1="14" x2="15" y2="4" />
        <circle cx="3" cy="14" r="1.6" fill="currentColor" />
        <circle cx="15" cy="4" r="1.6" fill="currentColor" />
      </svg>
    );
  if (tool === "hline")
    return (
      <svg {...common}>
        <line x1="2" y1="9" x2="16" y2="9" />
        <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common}>
      <line x1="2" y1="3.5" x2="16" y2="3.5" />
      <line x1="2" y1="7.5" x2="16" y2="7.5" opacity="0.7" />
      <line x1="2" y1="10.5" x2="16" y2="10.5" opacity="0.7" />
      <line x1="2" y1="14.5" x2="16" y2="14.5" />
    </svg>
  );
}

const NO_INDICATORS: IndicatorConfig[] = [];
const NO_IDS: string[] = [];
const NO_ALERTS: PriceAlert[] = [];
const NO_DRAWINGS: Drawing[] = [];

const SYNC: Record<SyncStatus, { text: string; short: string; title: string; tone: string }> = {
  loading: { short: "Loading…", text: "Loading your layout…", title: "Reading your saved watchlist, indicators, drawings and alerts", tone: "" },
  saving: { short: "Saving…", text: "Saving…", title: "Saving to your account", tone: "" },
  synced: { short: "Saved", text: "Saved to your account", title: "Watchlist, indicators, drawings and alerts are saved to your account", tone: "" },
  local: {
    short: "Saved in this browser only",
    text: "Saved in this browser only",
    title: "Couldn't reach your account; changes are kept in this browser and sent when it's back",
    tone: "text-[var(--mk-accent)]",
  },
};

function SyncNote({ status }: { status: SyncStatus }) {
  const s = SYNC[status];
  return (
    <span className={s.tone} title={s.title} role="status" aria-live="polite">
      <span className="sm:hidden">{s.short}</span>
      <span className="hidden sm:inline">{s.text}</span>
    </span>
  );
}

const NO_TRADES: Trade[] = [];

// Compact dropdowns for phones: no browser arrow (it adds a lot of padding), a small one of our own.
const mobileSelect =
  "h-9 appearance-none rounded-lg border border-[var(--mk-border)] bg-[var(--mk-raised)] bg-no-repeat py-0 pl-2 pr-5 text-xs font-semibold text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]";
const CHEVRON: React.CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5l3 3 3-3' fill='none' stroke='%239AA69F' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")",
  backgroundPosition: "right 0.4rem center",
  backgroundSize: "10px",
};
