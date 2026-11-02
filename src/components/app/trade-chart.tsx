"use client";

import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, money, price } from "@/lib/client";
import { timeframeLabel } from "@/lib/trading/symbols";
import type { Trade } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const COLORS = { profit: "#85BB65", loss: "#D9634F", gold: "#C8A24A", text: "#B9B4A6", grid: "rgba(255,255,255,0.05)" };

const toSec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * Candlestick chart of a market with trades drawn on it: an arrow where each trade
 * opened, a dot where it closed (with its result), and the entry / stop / target lines
 * when a single trade is shown. Uses TradingView's open-source lightweight-charts.
 */
export function TradeChart({
  symbol,
  from,
  to,
  trades,
  timeframe,
  height = 340,
}: {
  symbol: string;
  from: number;
  to: number;
  trades: Trade[];
  timeframe?: number;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tf: number; count: number } | null>(null);
  const tradeKey = trades.map((t) => `${t.id}:${t.status}:${t.exit_price}`).join(",");

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      try {
        const q = new URLSearchParams({ symbol, from: String(from), to: String(to), ...(timeframe ? { tf: String(timeframe) } : {}) });
        const [{ createChart, CrosshairMode, LineStyle }, data] = await Promise.all([
          import("lightweight-charts"),
          api<{ timeframe: number; candles: Candle[] }>(`/api/chart?${q}`),
        ]);
        if (disposed || !box.current) return;
        setInfo({ tf: data.timeframe, count: data.candles.length });
        if (!data.candles.length) return;

        const chart = createChart(box.current, {
          height,
          width: box.current.clientWidth,
          layout: { background: { color: "transparent" }, textColor: COLORS.text, fontFamily: "inherit" },
          grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
          timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
        });
        const series = chart.addCandlestickSeries({
          upColor: COLORS.profit,
          downColor: COLORS.loss,
          borderUpColor: COLORS.profit,
          borderDownColor: COLORS.loss,
          wickUpColor: COLORS.profit,
          wickDownColor: COLORS.loss,
        });
        type T = import("lightweight-charts").UTCTimestamp;
        series.setData(data.candles.map((c) => ({ time: c.epoch as T, open: c.open, high: c.high, low: c.low, close: c.close })));

        // Markers sit on the candle each event happened in.
        const tf = data.timeframe;
        const first = data.candles[0]!.epoch;
        const last = data.candles[data.candles.length - 1]!.epoch;
        const snap = (t: number) => Math.min(last, Math.max(first, Math.floor(t / tf) * tf)) as T;
        const markers: import("lightweight-charts").SeriesMarker<T>[] = [];
        // With many trades, labels would overlap: shapes only (tap a trade in Trades for details).
        const labels = trades.length <= 3;
        for (const t of trades) {
          if (t.status === "rejected") continue;
          const buy = t.side === "buy";
          markers.push({
            time: snap(toSec(t.opened_at)),
            position: buy ? "belowBar" : "aboveBar",
            color: buy ? COLORS.profit : COLORS.loss,
            shape: buy ? "arrowUp" : "arrowDown",
            text: labels ? `${buy ? "BUY" : "SELL"}${t.entry_price ? ` ${price(t.entry_price)}` : ""}` : undefined,
          });
          if (t.closed_at && t.status === "closed") {
            markers.push({
              time: snap(toSec(t.closed_at)),
              position: buy ? "aboveBar" : "belowBar",
              color: t.pnl >= 0 ? COLORS.profit : COLORS.loss,
              shape: "circle",
              text: labels ? `Exit ${money(t.pnl, "USD", true)}` : undefined,
            });
          }
        }
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        series.setMarkers(markers);

        if (trades.length === 1) {
          const t = trades[0]!;
          const line = (p: number | null, color: string, title: string, style = LineStyle.Dashed) =>
            p && series.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
          line(t.entry_price, COLORS.gold, "Entry", LineStyle.Solid);
          line(t.sl, COLORS.loss, "Stop");
          line(t.tp, COLORS.profit, "Target");
          if (t.exit_price) line(t.exit_price, COLORS.text, "Exit", LineStyle.Dotted);
        }
        if (data.candles.length > 80) {
          // Show the latest candles; scroll left for more.
          chart.timeScale().setVisibleLogicalRange({ from: data.candles.length - 80, to: data.candles.length + 2 });
        } else {
          chart.timeScale().fitContent();
        }

        const resize = new ResizeObserver(() => box.current && chart.applyOptions({ width: box.current.clientWidth }));
        resize.observe(box.current);
        cleanup = () => {
          resize.disconnect();
          chart.remove();
        };
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, from, to, timeframe, height, tradeKey]);

  return (
    <div>
      {error ? (
        <p className="py-10 text-center text-sm text-loss">{error}</p>
      ) : info && !info.count ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No price data for this period.</p>
      ) : (
        <div ref={box} style={{ height }} className="w-full" aria-label={`${symbol} price chart`} />
      )}
      {info && info.count > 0 && (
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {symbol} · {timeframeLabel(info.tf)} candles · prices from Deriv
        </p>
      )}
    </div>
  );
}

/** A chart window around one trade: some time before it opened until some time after it closed. */
export function tradeWindow(trade: Trade): { from: number; to: number } {
  const open = toSec(trade.opened_at);
  const close = trade.closed_at ? toSec(trade.closed_at) : Math.floor(Date.now() / 1000);
  const span = Math.max(close - open, 300);
  return { from: Math.floor(open - span * 1.5), to: Math.floor(Math.min(close + span, Date.now() / 1000)) };
}

/** A trade's details with its chart, in a dialog. */
export function TradeDialog({ trade, botName, onClose }: { trade: Trade | null; botName?: string; onClose: () => void }) {
  return (
    <Dialog open={Boolean(trade)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {trade && <TradeDetails trade={trade} botName={botName} />}
      </DialogContent>
    </Dialog>
  );
}

function TradeDetails({ trade, botName }: { trade: Trade; botName?: string }) {
  const symbol = trade.data_symbol ?? (/^(frx|cry|R_|1HZ|BOOM|CRASH)/.test(trade.symbol) ? trade.symbol : null);
  const { from, to } = tradeWindow(trade);
  const open = trade.status === "open" || trade.status === "pending";
  const rows: Array<[string, React.ReactNode]> = [
    ["Opened", new Date(trade.opened_at).toLocaleString()],
    ["Closed", trade.closed_at ? new Date(trade.closed_at).toLocaleString() : open ? "Still open" : "—"],
    ["Entry → exit", `${price(trade.entry_price)} → ${open ? `${price(trade.current_price)} (now)` : price(trade.exit_price)}`],
    ["Stop / target", `${price(trade.sl)} / ${price(trade.tp)}`],
    ["Size", trade.size_unit === "stake" ? `${money(trade.size)} stake` : `${trade.size} lots`],
    ["Bot", botName ?? (trade.external ? "Other EA / manual" : "—")],
  ];
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className={trade.side === "buy" ? "text-profit" : "text-loss"}>{trade.side.toUpperCase()}</span>
          {trade.symbol}
          <span className={cn("font-mono text-base", trade.pnl > 0 ? "text-profit" : trade.pnl < 0 ? "text-loss" : "text-muted-foreground")}>
            {trade.status === "rejected" ? "rejected" : money(trade.pnl, "USD", true)}
          </span>
        </DialogTitle>
      </DialogHeader>
      {symbol ? (
        <TradeChart symbol={symbol} from={from} to={to} trades={[trade]} height={300} />
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">No chart for this market: binaryTrades only has Deriv price data for it.</p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
            <dd className="font-mono text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {trade.close_reason && <p className="text-xs text-muted-foreground">{trade.close_reason}</p>}
      {trade.size_unit === "stake" && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Deriv Multiplier results include Deriv&apos;s commission, charged when the trade opens. A trade can therefore lose a little even when
          the price moved slightly in its favour.
        </p>
      )}
    </>
  );
}
