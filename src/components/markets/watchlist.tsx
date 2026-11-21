"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { SymbolSearch } from "@/components/markets/symbol-search";
import { formatPrice, priceDecimals } from "@/lib/markets/bars";
import { watchQuotes, type Quote } from "@/lib/markets/feeds";
import { MAX_WATCHLIST } from "@/lib/markets/state";
import { parseSymbolId, type MarketSymbol } from "@/lib/markets/symbols";
import { cn } from "@/lib/utils";

/** Live prices for the watchlist, redrawn at most twice a second. */
function useQuotes(ids: string[]): Record<string, Quote> {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const latest = useRef<Record<string, Quote>>({});
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    let dirty = false;
    const stop = watchQuotes(ids, (id, q) => {
      latest.current = { ...latest.current, [id]: q };
      dirty = true;
    });
    const t = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setQuotes(latest.current);
    }, 500);
    return () => {
      stop();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return quotes;
}

/** The watchlist: live price and 24h change per market; tap a row to chart it. */
export function Watchlist({
  ids,
  catalog,
  catalogLoading,
  currentId,
  onPick,
  onAdd,
  onRemove,
  touch = false,
}: {
  ids: string[];
  catalog: MarketSymbol[];
  catalogLoading: boolean;
  currentId: string | null;
  onPick: (id: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Phone layout: always show the remove buttons. */
  touch?: boolean;
}) {
  const quotes = useQuotes(ids);
  const meta = (id: string) => catalog.find((s) => s.id === id);
  const full = ids.length >= MAX_WATCHLIST;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2.5">
        {full ? (
          <p className="text-xs text-[var(--mk-muted)]">Up to {MAX_WATCHLIST} markets. Remove one to add another.</p>
        ) : (
          <SymbolSearch
            catalog={catalog.filter((s) => !ids.includes(s.id))}
            current={null}
            loading={catalogLoading}
            onPick={(s) => onAdd(s.id)}
            placeholder="Add a market"
            label="Add a market to the watchlist"
            className="w-full sm:w-full"
            alignRight
          />
        )}
      </div>
      {ids.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-[var(--mk-muted)]">
          Your watchlist is empty. Add markets with the search above or the ☆ next to the chart&apos;s market.
        </p>
      ) : (
        <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" aria-label="Watchlist">
          {ids.map((id) => {
            const m = meta(id);
            const q = quotes[id];
            const code = m?.code ?? parseSymbolId(id)?.code ?? id;
            const d = priceDecimals(q?.price ?? 1, m?.pipSize);
            const up = (q?.change ?? 0) >= 0;
            const current = id === currentId;
            return (
              <li key={id} className="group relative">
                <button
                  type="button"
                  onClick={() => onPick(id)}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-2 rounded-xl py-1.5 pl-2.5 text-left hover:bg-[var(--mk-raised)]",
                    touch ? "pr-11" : "pr-2.5 group-focus-within:pr-11 group-hover:pr-11",
                    current && "bg-[var(--mk-raised)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm text-[var(--mk-text)]", current && "font-semibold")}>{m?.name ?? code}</span>
                    <span className="block truncate font-mono text-[10px] text-[var(--mk-muted)]">
                      {code}
                      {q?.closed && " · closed"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono tabular-nums">
                    <span className="block text-sm text-[var(--mk-text)]">{q?.price != null ? formatPrice(q.price, d) : "—"}</span>
                    <span
                      className={cn("block text-[11px]", q?.change == null ? "text-[var(--mk-muted)]" : up ? "text-[var(--mk-up)]" : "text-[var(--mk-down)]")}
                    >
                      {q?.change == null ? "—" : `${up ? "+" : ""}${q.change.toFixed(2)}%`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  aria-label={`Remove ${m?.name ?? code} from the watchlist`}
                  className={cn(
                    "absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-bg)] hover:text-[var(--mk-down)]",
                    !touch && "opacity-0 focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
