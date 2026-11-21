"use client";

// Market data for the Markets page, straight from the browser to public, key-free feeds:
//  - Deriv (forex, gold, synthetics — the markets binaryTrades bots trade) over one shared WebSocket
//  - Binance spot (crypto, with volume) over its public market-data REST API and streams
// Nothing here needs an API key. Historical candles are cached per symbol and timeframe.

import { aggregate, changePercent, foldLive, reference24h, timeframe, type Bar, type TimeframeId } from "@/lib/markets/bars";
import { ReconnectingSocket, type SocketStatus } from "@/lib/markets/socket";
import { STARTER_SYMBOLS, fromBinance, fromDeriv, mergeCatalog, parseSymbolId, type DerivActiveSymbol, type MarketSymbol } from "@/lib/markets/symbols";

export type FeedStatus = SocketStatus | "market-closed";

export class MarketDataError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

/** A watchlist quote: last price, change over 24 hours (%), and whether the market is closed. */
export interface Quote {
  price: number | null;
  change: number | null;
  closed?: boolean;
}

export interface StreamHandlers {
  onBar: (bar: Bar) => void;
  onStatus: (status: FeedStatus, detail?: string) => void;
}

interface Feed {
  history(code: string, tf: TimeframeId): Promise<Bar[]>;
  stream(code: string, tf: TimeframeId, h: StreamHandlers): () => void;
  reference24h(code: string): Promise<number | null>;
  catalog(): Promise<MarketSymbol[]>;
}

const HISTORY_TTL = 120_000;
const CATALOG_TTL = 12 * 3600_000;

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const { at, value } = JSON.parse(raw) as { at: number; value: T };
      if (Date.now() - at < ttl) return Promise.resolve(value);
    }
  } catch {
    // storage unavailable: just load
  }
  return load().then((value) => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
    } catch {
      // too big or unavailable
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// Deriv

const DERIV_URL = `wss://api.derivws.com/trading/v1/options/ws/public?app_id=${process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089"}`;
type Json = Record<string, unknown>;

interface DerivSub {
  key: number;
  code: string;
  granularity: number;
  tf: TimeframeId;
  /** Daily candles of the open weeks, for 1W (Deriv has no weekly candles). */
  base: Bar[];
  derivId: string | null;
  closed: boolean;
  h: StreamHandlers;
}

const toBar = (c: Json): Bar => ({
  time: Number(c.open_time ?? c.epoch),
  open: Number(c.open),
  high: Number(c.high),
  low: Number(c.low),
  close: Number(c.close),
});

class DerivFeed implements Feed {
  private socket: ReconnectingSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (j: Json) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private subs = new Map<number, DerivSub>();
  private ticks = new Map<number, { code: string; derivId: string | null; onPrice: (price: number | null, closed: boolean) => void }>();
  private status: SocketStatus = "connecting";

  private ensure(): ReconnectingSocket {
    if (this.socket) return this.socket;
    this.socket = new ReconnectingSocket({
      url: DERIV_URL,
      ping: { ms: 30_000, payload: JSON.stringify({ ping: 1 }) },
      staleMs: 75_000,
      onStatus: (s) => {
        this.status = s;
        for (const sub of this.subs.values()) if (!sub.closed || s !== "live") sub.h.onStatus(s);
      },
      onOpen: () => {
        for (const sub of this.subs.values()) this.subscribe(sub);
        for (const [key, t] of this.ticks) this.socket?.send({ ticks: t.code, subscribe: 1, req_id: key });
      },
      onMessage: (text) => this.onMessage(text),
    });
    return this.socket;
  }

  private onMessage(text: string) {
    let j: Json;
    try {
      j = JSON.parse(text) as Json;
    } catch {
      return;
    }
    const reqId = typeof j.req_id === "number" ? j.req_id : null;
    if (reqId && this.ticks.has(reqId)) {
      const t = this.ticks.get(reqId)!;
      const err = j.error as Json | undefined;
      if (err) {
        if (err.code === "MarketIsClosed") t.onPrice(null, true);
        return;
      }
      const tick = j.tick as Json | undefined;
      t.derivId = String((j.subscription as Json | undefined)?.id ?? tick?.id ?? "") || t.derivId;
      if (tick && Number.isFinite(Number(tick.quote))) t.onPrice(Number(tick.quote), false);
      return;
    }
    if (j.msg_type === "ohlc") {
      const o = j.ohlc as Json;
      const id = (j.subscription as Json | undefined)?.id ?? o.id;
      const sub = [...this.subs.values()].find((s) => s.derivId === id) ?? (reqId ? this.subs.get(reqId) : undefined);
      if (sub) this.emit(sub, toBar(o));
      return;
    }
    if (reqId && this.subs.has(reqId)) {
      const sub = this.subs.get(reqId)!;
      const err = j.error as Json | undefined;
      if (err) {
        if (err.code === "MarketIsClosed") {
          sub.closed = true;
          // Deriv gives the reopening time in UTC without saying so.
          sub.h.onStatus("market-closed", String(err.message ?? "Market closed").replace(/(\d{4}-\d\d-\d\d \d\d:\d\d):\d\d\.?$/, "$1 UTC."));
        } else if (err.code !== "AlreadySubscribed") {
          sub.h.onStatus("reconnecting", String(err.message ?? ""));
        }
        return;
      }
      sub.closed = false;
      sub.derivId = String((j.subscription as Json | undefined)?.id ?? "") || null;
      // The reply carries the latest candles: they fill any gap left by a reconnect.
      for (const c of (j.candles as Json[] | undefined) ?? []) this.emit(sub, toBar(c));
      sub.h.onStatus("live");
      return;
    }
    if (reqId && this.pending.has(reqId)) {
      const p = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      clearTimeout(p.timer);
      const err = j.error as Json | undefined;
      if (err) p.reject(derivError(err));
      else p.resolve(j);
    }
  }

  private emit(sub: DerivSub, bar: Bar) {
    if (sub.tf === "1W") sub.h.onBar(foldLive(sub.base, bar, 604800));
    else sub.h.onBar({ ...bar, time: Math.floor(bar.time / sub.granularity) * sub.granularity });
  }

  private request(payload: Json, timeoutMs = 15_000): Promise<Json> {
    const socket = this.ensure();
    const req_id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(new MarketDataError("UNAVAILABLE", "Market data unavailable — Deriv didn't answer in time."));
      }, timeoutMs);
      this.pending.set(req_id, { resolve, reject, timer });
      socket.send({ ...payload, req_id });
    });
  }

  private subscribe(sub: DerivSub) {
    this.ensure().send({
      ticks_history: sub.code,
      style: "candles",
      granularity: sub.granularity,
      count: sub.tf === "1W" ? 8 : 3,
      end: "latest",
      subscribe: 1,
      req_id: sub.key,
    });
  }

  async history(code: string, tf: TimeframeId): Promise<Bar[]> {
    const t = timeframe(tf)!;
    const granularity = tf === "1W" ? 86400 : t.seconds;
    const j = await this.request({ ticks_history: code, style: "candles", granularity, count: 1000, end: "latest" });
    const bars = ((j.candles as Json[] | undefined) ?? []).map(toBar);
    return aggregate(bars, t.seconds);
  }

  stream(code: string, tf: TimeframeId, h: StreamHandlers): () => void {
    const key = this.nextId++;
    const sub: DerivSub = { key, code, tf, granularity: tf === "1W" ? 86400 : timeframe(tf)!.seconds, base: [], derivId: null, closed: false, h };
    this.subs.set(key, sub);
    h.onStatus(this.socket?.isOpen ? "connecting" : this.status);
    if (tf === "1W") {
      // Seed the open week's daily candles so live days fold into the right weekly candle.
      this.request({ ticks_history: code, style: "candles", granularity: 86400, count: 8, end: "latest" })
        .then((j) => {
          if (!this.subs.has(key)) return;
          sub.base = ((j.candles as Json[] | undefined) ?? []).map(toBar);
          this.subscribe(sub);
        })
        .catch(() => this.subscribe(sub));
    } else {
      this.subscribe(sub);
    }
    return () => {
      this.subs.delete(key);
      if (sub.derivId) this.socket?.send({ forget: sub.derivId });
    };
  }

  async reference24h(code: string): Promise<number | null> {
    return (await this.lastDay(code)).reference;
  }

  /** Last price and the price 24 hours earlier, from hourly candles (works while the market is closed). */
  async lastDay(code: string): Promise<{ reference: number | null; last: number | null }> {
    const j = await this.request({ ticks_history: code, style: "candles", granularity: 3600, count: 25, end: "latest" });
    const bars = ((j.candles as Json[] | undefined) ?? []).map(toBar);
    return { reference: reference24h(bars), last: bars.at(-1)?.close ?? null };
  }

  /** Live prices for several markets on the shared connection. */
  watchTicks(code: string, onPrice: (price: number | null, closed: boolean) => void): () => void {
    const key = this.nextId++;
    this.ticks.set(key, { code, derivId: null, onPrice });
    this.ensure().send({ ticks: code, subscribe: 1, req_id: key });
    return () => {
      const t = this.ticks.get(key);
      this.ticks.delete(key);
      if (t?.derivId) this.socket?.send({ forget: t.derivId });
    };
  }

  catalog(): Promise<MarketSymbol[]> {
    return cached("bt.markets.deriv.v1", CATALOG_TTL, async () => {
      const j = await this.request({ active_symbols: "brief" });
      return fromDeriv((j.active_symbols as DerivActiveSymbol[] | undefined) ?? []);
    });
  }

  dispose() {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.subs.clear();
    this.ticks.clear();
    this.socket?.close();
    this.socket = null;
  }
}

function derivError(err: Json): MarketDataError {
  if (err.code === "InvalidSymbol") return new MarketDataError("NOT_FOUND", "Symbol not found");
  return new MarketDataError("UNAVAILABLE", `Market data unavailable — ${String(err.message ?? "Deriv error")}`);
}

// ---------------------------------------------------------------------------
// Binance (public market data endpoints, no key)

const BINANCE_REST = "https://data-api.binance.vision";
const BINANCE_WS = "wss://data-stream.binance.vision/ws";
const BINANCE_INTERVAL: Record<TimeframeId, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1D": "1d", "1W": "1w" };

type Kline = [number, string, string, string, string, string, ...unknown[]];
const fromKline = (k: Kline): Bar => ({
  time: Math.floor(k[0] / 1000),
  open: Number(k[1]),
  high: Number(k[2]),
  low: Number(k[3]),
  close: Number(k[4]),
  volume: Number(k[5]),
});

class BinanceFeed implements Feed {
  /** Binance asks clients to back off after 429/418; no requests until this time. */
  private blockedUntil = 0;

  private async get<T>(path: string): Promise<T> {
    if (Date.now() < this.blockedUntil) throw new MarketDataError("UNAVAILABLE", "Market data unavailable — Binance asked us to slow down. Try again shortly.");
    let res: Response;
    try {
      res = await fetch(BINANCE_REST + path);
    } catch {
      throw new MarketDataError("UNAVAILABLE", "Market data unavailable — can't reach Binance.");
    }
    if (res.status === 429 || res.status === 418) {
      const wait = Number(res.headers.get("retry-after")) || 60;
      this.blockedUntil = Date.now() + wait * 1000;
      throw new MarketDataError("UNAVAILABLE", "Market data unavailable — Binance asked us to slow down. Try again shortly.");
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { code?: number };
      if (body.code === -1121) throw new MarketDataError("NOT_FOUND", "Symbol not found");
    }
    if (!res.ok) throw new MarketDataError("UNAVAILABLE", `Market data unavailable — Binance answered ${res.status}.`);
    return (await res.json()) as T;
  }

  async history(code: string, tf: TimeframeId): Promise<Bar[]> {
    const rows = await this.get<Kline[]>(`/api/v3/klines?symbol=${encodeURIComponent(code)}&interval=${BINANCE_INTERVAL[tf]}&limit=1000`);
    return rows.map(fromKline);
  }

  stream(code: string, tf: TimeframeId, h: StreamHandlers): () => void {
    let stopped = false;
    const socket = new ReconnectingSocket({
      url: `${BINANCE_WS}/${code.toLowerCase()}@kline_${BINANCE_INTERVAL[tf]}`,
      onStatus: (s) => h.onStatus(s),
      onOpen: () => {
        // Fill candles missed while disconnected (or since the cached history was loaded).
        this.get<Kline[]>(`/api/v3/klines?symbol=${encodeURIComponent(code)}&interval=${BINANCE_INTERVAL[tf]}&limit=3`)
          .then((rows) => {
            if (!stopped) rows.map(fromKline).forEach(h.onBar);
          })
          .catch(() => {});
      },
      onMessage: (text) => {
        try {
          const k = (JSON.parse(text) as { k?: { t: number; o: string; h: string; l: string; c: string; v: string } }).k;
          if (k) h.onBar({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
        } catch {
          // ignore malformed frames
        }
      },
    });
    return () => {
      stopped = true;
      socket.close();
    };
  }

  async reference24h(code: string): Promise<number | null> {
    const t = await this.get<{ openPrice: string }>(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(code)}`);
    return Number(t.openPrice) || null;
  }

  /** Live price and 24h change for several pairs over one combined stream (plus a snapshot to start). */
  watchQuotes(codes: string[], onQuote: (code: string, q: Quote) => void): () => void {
    let stopped = false;
    const quote = (c: number, o: number): Quote => ({ price: c, change: o ? ((c - o) / o) * 100 : null });
    this.get<Array<{ symbol: string; lastPrice: string; openPrice: string }>>(`/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(codes))}&type=MINI`)
      .then((rows) => {
        if (!stopped) for (const r of rows) onQuote(r.symbol, quote(Number(r.lastPrice), Number(r.openPrice)));
      })
      .catch(() => {});
    const socket = new ReconnectingSocket({
      url: `${BINANCE_WS.replace(/\/ws$/, "")}/stream?streams=${codes.map((c) => `${c.toLowerCase()}@miniTicker`).join("/")}`,
      onMessage: (text) => {
        try {
          const d = (JSON.parse(text) as { data?: { s: string; c: string; o: string } }).data;
          if (d) onQuote(d.s, quote(Number(d.c), Number(d.o)));
        } catch {
          // ignore malformed frames
        }
      },
    });
    return () => {
      stopped = true;
      socket.close();
    };
  }

  catalog(): Promise<MarketSymbol[]> {
    return cached("bt.markets.binance.v1", CATALOG_TTL, async () => fromBinance(await this.get<Array<{ symbol: string }>>("/api/v3/ticker/price")));
  }
}

// ---------------------------------------------------------------------------
// Simulated feed for local development only (?feed=mock): a random walk with volume.

class MockFeed implements Feed {
  private price = new Map<string, number>();
  dropAll: Array<() => void> = [];

  private seed(code: string) {
    if (!this.price.has(code)) this.price.set(code, code.includes("BTC") ? 60000 : code.includes("XAU") ? 3500 : 1000);
    return this.price.get(code)!;
  }

  async history(code: string, tf: TimeframeId): Promise<Bar[]> {
    if (code.startsWith("NOPE")) throw new MarketDataError("NOT_FOUND", "Symbol not found");
    if (code.startsWith("DOWN")) throw new MarketDataError("UNAVAILABLE", "Market data unavailable — simulated outage.");
    await new Promise((r) => setTimeout(r, 400));
    const s = timeframe(tf)!.seconds;
    const now = Math.floor(Date.now() / 1000 / s) * s;
    let p = this.seed(code);
    let x = 12345;
    const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
    const bars: Bar[] = [];
    for (let i = 299; i >= 0; i--) {
      const open = p;
      const close = open * (1 + (rnd() - 0.5) * 0.01);
      bars.push({ time: now - i * s, open, close, high: Math.max(open, close) * (1 + rnd() * 0.003), low: Math.min(open, close) * (1 - rnd() * 0.003), volume: Math.round(rnd() * 1000) });
      p = close;
    }
    this.price.set(code, p);
    return bars;
  }

  stream(code: string, tf: TimeframeId, h: StreamHandlers): () => void {
    const s = timeframe(tf)!.seconds;
    let up = true;
    let bar: Bar | null = null;
    h.onStatus("live");
    const timer = setInterval(() => {
      if (!up) return;
      const t = Math.floor(Date.now() / 1000 / s) * s;
      const p = this.seed(code) * (1 + (Math.random() - 0.5) * 0.002);
      this.price.set(code, p);
      bar = bar && bar.time === t ? { ...bar, high: Math.max(bar.high, p), low: Math.min(bar.low, p), close: p, volume: (bar.volume ?? 0) + 5 } : { time: t, open: p, high: p, low: p, close: p, volume: 5 };
      h.onBar(bar);
    }, 500);
    const drop = () => {
      up = false;
      h.onStatus("reconnecting");
      setTimeout(() => {
        up = true;
        h.onStatus("live");
      }, 2500);
    };
    this.dropAll.push(drop);
    return () => {
      clearInterval(timer);
      this.dropAll = this.dropAll.filter((d) => d !== drop);
    };
  }

  async reference24h(code: string) {
    return this.seed(code) * 0.98;
  }

  watchQuotes(ids: string[], onQuote: (id: string, q: Quote) => void): () => void {
    const tick = () =>
      ids.forEach((id) => {
        const code = parseSymbolId(id)?.code ?? id;
        if (code.includes("XAU")) return onQuote(id, { price: this.seed(code), change: 2, closed: true });
        const p = this.seed(code) * (1 + (Math.random() - 0.5) * 0.002);
        this.price.set(code, p);
        onQuote(id, { price: p, change: ((p - this.seed(code) * 0.98) / (this.seed(code) * 0.98)) * 100 });
      });
    tick();
    const t = setInterval(tick, 700);
    return () => clearInterval(t);
  }

  async catalog() {
    return [...STARTER_SYMBOLS, { id: "binance:NOPEUSDT", provider: "binance" as const, code: "NOPEUSDT", name: "NOPE/USDT (test: not found)", group: "Crypto", hasVolume: true }];
  }
}

// ---------------------------------------------------------------------------

let deriv: DerivFeed | null = null;
let binance: BinanceFeed | null = null;
let mock: MockFeed | null = null;

function mockFeedOn(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("feed") === "mock";
}

function feedFor(id: string): { feed: Feed; code: string } {
  const parsed = parseSymbolId(id);
  if (!parsed) throw new MarketDataError("NOT_FOUND", "Symbol not found");
  if (mockFeedOn()) {
    mock ??= new MockFeed();
    (window as unknown as { __marketsDrop?: () => void }).__marketsDrop = () => mock!.dropAll.forEach((d) => d());
    return { feed: mock, code: parsed.code };
  }
  if (parsed.provider === "deriv") return { feed: (deriv ??= new DerivFeed()), code: parsed.code };
  return { feed: (binance ??= new BinanceFeed()), code: parsed.code };
}

const historyCache = new Map<string, { at: number; bars: Promise<Bar[]> }>();

/** Candles for a market and timeframe; cached for two minutes (the live stream fills the gap). */
export function loadHistory(id: string, tf: TimeframeId): Promise<Bar[]> {
  const key = `${id}|${tf}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL) return hit.bars.then((b) => b.map((x) => ({ ...x })));
  let feed: { feed: Feed; code: string };
  try {
    feed = feedFor(id);
  } catch (e) {
    return Promise.reject(e);
  }
  const bars = feed.feed.history(feed.code, tf);
  historyCache.set(key, { at: Date.now(), bars });
  bars.catch(() => historyCache.delete(key));
  return bars.then((b) => b.map((x) => ({ ...x })));
}

/** Live candles for a market; returns a function that stops the stream. */
export function streamBars(id: string, tf: TimeframeId, h: StreamHandlers): () => void {
  const { feed, code } = feedFor(id);
  return feed.stream(code, tf, h);
}

export function load24hReference(id: string): Promise<number | null> {
  try {
    const { feed, code } = feedFor(id);
    return feed.reference24h(code);
  } catch (e) {
    return Promise.reject(e);
  }
}

/** Live quotes for a watchlist; returns a function that stops them. Calls onQuote with the market id. */
export function watchQuotes(ids: string[], onQuote: (id: string, q: Quote) => void): () => void {
  if (mockFeedOn()) {
    mock ??= new MockFeed();
    return mock.watchQuotes(ids, onQuote);
  }
  const stops: Array<() => void> = [];
  const parsed = ids.map(parseSymbolId).filter(Boolean) as Array<{ provider: "deriv" | "binance"; code: string }>;
  const bn = parsed.filter((p) => p.provider === "binance").map((p) => p.code);
  if (bn.length) stops.push((binance ??= new BinanceFeed()).watchQuotes(bn, (code, q) => onQuote(`binance:${code}`, q)));
  for (const { code } of parsed.filter((p) => p.provider === "deriv")) {
    const d = (deriv ??= new DerivFeed());
    let reference: number | null = null;
    let last: number | null = null;
    let closed = false;
    let live = true;
    const emit = () => live && onQuote(`deriv:${code}`, { price: last, change: changePercent(last, reference), closed });
    d.lastDay(code)
      .then((r) => {
        reference = r.reference;
        if (last === null) last = r.last;
        emit();
      })
      .catch(() => {});
    stops.push(
      d.watchTicks(code, (price, isClosed) => {
        closed = isClosed;
        if (price !== null) last = price;
        emit();
      }),
    );
    stops.push(() => (live = false));
  }
  return () => stops.forEach((s) => s());
}

/** Every market we can chart: starter markets first, then Deriv's list, then Binance pairs. */
export async function loadCatalog(): Promise<MarketSymbol[]> {
  if (mockFeedOn()) return feedFor("binance:BTCUSDT").feed.catalog();
  const [d, b] = await Promise.allSettled([(deriv ??= new DerivFeed()).catalog(), (binance ??= new BinanceFeed()).catalog()]);
  return mergeCatalog(STARTER_SYMBOLS, d.status === "fulfilled" ? d.value : [], b.status === "fulfilled" ? b.value : []);
}

/** Closes shared connections (when leaving the Markets page). */
export function disposeFeeds() {
  deriv?.dispose();
  deriv = null;
}
