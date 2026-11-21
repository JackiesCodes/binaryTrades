import { describe, expect, it } from "vitest";

import { aggregate, backoffDelay, bucketStart, changePercent, foldLive, formatPrice, formatVolume, mergeLive, priceDecimals, reference24h, type Bar } from "@/lib/markets/bars";
import { ReconnectingSocket, type SocketStatus } from "@/lib/markets/socket";
import { STARTER_SYMBOLS, fromBinance, fromDeriv, mergeCatalog, parseSymbolId, searchSymbols } from "@/lib/markets/symbols";

const bar = (time: number, o: number, h: number, l: number, c: number, volume?: number): Bar => ({ time, open: o, high: h, low: l, close: c, volume });

describe("candles", () => {
  it("starts weeks on Monday 00:00 UTC", () => {
    const wed = Date.UTC(2026, 10, 18, 15) / 1000; // Wednesday 18 Nov 2026
    expect(new Date(bucketStart(wed, 604800) * 1000).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(bucketStart(3725, 3600)).toBe(3600);
  });

  it("builds weekly candles from daily ones, and tidies partial or duplicate candles", () => {
    const mon = Date.UTC(2026, 10, 16) / 1000;
    const days = [bar(mon, 10, 12, 9, 11, 1), bar(mon + 86400, 11, 15, 10, 14, 2), bar(mon + 7 * 86400, 14, 14, 13, 13, 3)];
    expect(aggregate(days, 604800)).toEqual([bar(mon, 10, 15, 9, 14, 3), bar(mon + 7 * 86400, 14, 14, 13, 13, 3)]);
    // A partial first candle stamped mid-bucket snaps to the bucket and merges with its twin.
    expect(aggregate([bar(7230, 1, 2, 0.5, 1.5), bar(7200, 1.5, 3, 1, 2)], 3600)).toEqual([bar(7200, 1.5, 3, 0.5, 1.5)]);
    // Markets without volume keep it undefined rather than 0.
    expect(aggregate([bar(0, 1, 1, 1, 1)], 60)[0]!.volume).toBeUndefined();
  });

  it("merges live candles: updates the newest, appends a newer one, ignores late older ones", () => {
    const s = [bar(60, 1, 1, 1, 1), bar(120, 1, 2, 1, 2)];
    expect(mergeLive(s, bar(120, 1, 3, 1, 3))).toEqual(bar(120, 1, 3, 1, 3));
    expect(mergeLive(s, bar(180, 3, 3, 3, 3))).toEqual(bar(180, 3, 3, 3, 3));
    expect(s).toHaveLength(3);
    expect(mergeLive(s, bar(0, 9, 9, 9, 9))).toBeNull();
    expect(s).toHaveLength(3);
  });

  it("folds a live day into its week", () => {
    const mon = Date.UTC(2026, 10, 16) / 1000;
    const base = [bar(mon, 10, 12, 9, 11)];
    expect(foldLive(base, bar(mon + 86400, 11, 20, 8, 19), 604800)).toEqual(bar(mon, 10, 20, 8, 19));
    expect(foldLive(base, bar(mon + 86400, 11, 21, 8, 18), 604800)).toEqual(bar(mon, 10, 21, 8, 18));
  });

  it("measures the 24h change from the open 24 hours back", () => {
    const hours = Array.from({ length: 30 }, (_, i) => bar(i * 3600, 100 + i, 0, 0, 101 + i));
    expect(reference24h(hours)).toBe(100 + 5);
    expect(changePercent(110, 100)).toBeCloseTo(10);
    expect(changePercent(110, 0)).toBeNull();
    expect(changePercent(null, 100)).toBeNull();
  });

  it("backs off 1s, 2s, 4s … capped at 30s", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 10].map((a) => backoffDelay(a, mid))).toEqual([1000, 2000, 4000, 8000, 30000]);
    expect(backoffDelay(0, () => 0)).toBe(800);
    expect(backoffDelay(0, () => 1)).toBe(1200);
  });

  it("formats prices and volumes", () => {
    expect(priceDecimals(1.0845, 0.00001)).toBe(5);
    expect(priceDecimals(60123)).toBe(2);
    expect(priceDecimals(0.000012)).toBe(8);
    expect(formatPrice(60123.456, 2)).toBe("60,123.46");
    expect(formatPrice(null, 2)).toBe("—");
    expect(formatVolume(1_234_567)).toBe("1.23M");
    expect(formatVolume(12.5)).toBe("12.50");
  });
});

describe("market catalog", () => {
  it("parses ids and refuses anything else", () => {
    expect(parseSymbolId("deriv:frxXAUUSD")).toEqual({ provider: "deriv", code: "frxXAUUSD" });
    expect(parseSymbolId("binance:BTCUSDT")).toEqual({ provider: "binance", code: "BTCUSDT" });
    expect(parseSymbolId("evil:<script>")).toBeNull();
    expect(parseSymbolId("binance:BTC USDT")).toBeNull();
  });

  it("reads Deriv's and Binance's lists", () => {
    const d = fromDeriv([
      { underlying_symbol: "R_100", underlying_symbol_name: "Volatility 100 Index", market: "synthetic_index", pip_size: 0.01 },
      { underlying_symbol: "OLD", underlying_symbol_name: "Suspended", market: "forex", is_trading_suspended: 1 },
    ]);
    expect(d).toEqual([{ id: "deriv:R_100", provider: "deriv", code: "R_100", name: "Volatility 100 Index", group: "Synthetics", pipSize: 0.01, hasVolume: false }]);
    expect(fromBinance([{ symbol: "PEPEUSDT" }, { symbol: "ETHBTC" }, { symbol: "XYZTRY" }]).map((s) => s.name)).toEqual(["PEPE/USDT", "ETH/BTC"]);
    expect(mergeCatalog(STARTER_SYMBOLS, fromBinance([{ symbol: "BTCUSDT" }])).filter((s) => s.id === "binance:BTCUSDT")).toHaveLength(1);
  });

  it("searches by code or name, best match first", () => {
    const cat = mergeCatalog(STARTER_SYMBOLS, fromBinance([{ symbol: "BTCDOMUSDT" }, { symbol: "WBTCUSDT" }, { symbol: "BTCUSDC" }]));
    expect(searchSymbols(cat, "btc")[0]!.id).toBe("binance:BTCUSDT");
    expect(searchSymbols(cat, "gold")[0]!.id).toBe("deriv:frxXAUUSD");
    expect(searchSymbols(cat, "xauusd")[0]!.id).toBe("deriv:frxXAUUSD");
    expect(searchSymbols(cat, "eur/usd")[0]!.id).toBe("deriv:frxEURUSD");
    expect(searchSymbols(cat, "volatility 100")[0]!.id).toBe("deriv:R_100");
    expect(searchSymbols(cat, "step")[0]!.id).toBe("deriv:stpRNG");
    expect(searchSymbols(cat, "zzzz")).toEqual([]);
  });
});

// A WebSocket double the test drives by hand.
class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
}

function fakeTimers() {
  const queue: Array<{ fn: () => void; ms: number }> = [];
  return {
    queue,
    timers: {
      setTimeout: ((fn: () => void, ms: number) => (queue.push({ fn, ms }), queue.length)) as unknown as typeof setTimeout,
      clearTimeout: (() => {}) as typeof clearTimeout,
      setInterval: (() => 0) as unknown as typeof setInterval,
      clearInterval: (() => {}) as typeof clearInterval,
    },
  };
}

describe("reconnecting socket", () => {
  it("goes live, reconnects with growing delays after drops, resubscribes, and stops on close", () => {
    FakeWS.all = [];
    const { queue, timers } = fakeTimers();
    const statuses: SocketStatus[] = [];
    let opens = 0;
    const got: string[] = [];
    const s = new ReconnectingSocket({
      url: "wss://x",
      WebSocketImpl: FakeWS,
      timers,
      onStatus: (st) => statuses.push(st),
      onOpen: (sock) => {
        opens++;
        sock.send({ subscribe: 1 });
      },
      onMessage: (d) => got.push(d),
    });
    s.send("queued-before-open");
    FakeWS.all[0]!.open();
    expect(FakeWS.all[0]!.sent).toEqual(['{"subscribe":1}', "queued-before-open"]);
    FakeWS.all[0]!.onmessage?.({ data: "tick" });
    expect(got).toEqual(["tick"]);

    FakeWS.all[0]!.drop();
    expect(statuses).toEqual(["live", "reconnecting"]);
    expect(queue[0]!.ms).toBeGreaterThanOrEqual(800);
    queue.shift()!.fn(); // retry 1
    FakeWS.all[1]!.drop(); // fails again
    expect(queue[0]!.ms).toBeGreaterThanOrEqual(1600); // longer wait
    queue.shift()!.fn();
    FakeWS.all[2]!.open();
    expect(opens).toBe(2);
    expect(FakeWS.all[2]!.sent).toEqual(['{"subscribe":1}']);
    expect(statuses.at(-1)).toBe("live");

    s.close();
    FakeWS.all[2]!.drop();
    expect(statuses.at(-1)).toBe("closed");
    expect(queue).toHaveLength(0); // no retry after close
  });
});

describe("reconnecting socket timers", () => {
  it("calls the default timers as plain functions (browsers throw 'Illegal invocation' otherwise)", () => {
    const realSetTimeout = globalThis.setTimeout;
    const seen: unknown[] = [];
    // A setTimeout that, like a browser's, refuses to run as a method of another object.
    globalThis.setTimeout = function (this: unknown, fn: () => void, ms?: number) {
      seen.push(this);
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return realSetTimeout(fn, ms);
    } as typeof setTimeout;
    try {
      FakeWS.all = [];
      const s = new ReconnectingSocket({ url: "wss://x", WebSocketImpl: FakeWS, onMessage: () => {} });
      expect(() => FakeWS.all[0]!.drop()).not.toThrow(); // schedules a retry with setTimeout
      expect(seen.length).toBe(1);
      s.close();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
