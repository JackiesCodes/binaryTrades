"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { searchSymbols, type MarketSymbol } from "@/lib/markets/symbols";
import { cn } from "@/lib/utils";

export interface SymbolSearchHandle {
  focus(): void;
}

/** Market search with autocomplete: type a code or name, pick with arrows + Enter or a tap. */
export const SymbolSearch = forwardRef<
  SymbolSearchHandle,
  {
    catalog: MarketSymbol[];
    current: MarketSymbol | null;
    loading: boolean;
    onPick: (s: MarketSymbol) => void;
    /** Placeholder when there is no current market (e.g. "Add a market"). */
    placeholder?: string;
    label?: string;
    className?: string;
    /** Open the suggestions towards the left (for a search on the right edge). */
    alignRight?: boolean;
  }
>(function SymbolSearch({ catalog, current, loading, onPick, placeholder = "Search markets", label = "Search markets", className, alignRight }, ref) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [hi, setHi] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const listId = useId();
    const results = useMemo(() => searchSymbols(catalog, q, 12), [catalog, q]);

    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

    useEffect(() => setHi(0), [q]);
    useEffect(() => {
      if (!open) return;
      const close = (e: PointerEvent) => {
        if (!wrap.current?.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener("pointerdown", close);
      return () => document.removeEventListener("pointerdown", close);
    }, [open]);

    const pick = (s: MarketSymbol) => {
      onPick(s);
      setOpen(false);
      setQ("");
      input.current?.blur();
    };

    return (
      <div ref={wrap} className={cn("relative min-w-0 flex-1 sm:w-64 sm:flex-none", className)}>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--mk-border)] bg-[var(--mk-raised)] px-3 focus-within:border-[var(--mk-accent)]">
          <Search className="h-4 w-4 shrink-0 text-[var(--mk-muted)]" aria-hidden />
          <span className="sr-only">{label}</span>
          <input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && results[hi] ? `${listId}-${hi}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold text-[var(--mk-text)] outline-none placeholder:font-normal placeholder:text-[var(--mk-muted)]"
            placeholder={current ? current.name : placeholder}
            value={open ? q : current?.name ?? ""}
            onFocus={() => {
              setOpen(true);
              setQ("");
            }}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setHi((h) => Math.min(results.length - 1, h + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[hi]) pick(results[hi]!);
              } else if (e.key === "Escape") {
                setOpen(false);
                input.current?.blur();
              }
            }}
          />
          <kbd className="hidden rounded border border-[var(--mk-border)] px-1.5 font-mono text-[10px] text-[var(--mk-muted)] lg:inline">/</kbd>
        </label>
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Markets"
            className={cn(
              "scrollbar-thin absolute left-0 right-0 top-12 z-50 max-h-[min(420px,60dvh)] overflow-y-auto rounded-xl border border-[var(--mk-border)] bg-[var(--mk-panel)] p-1 shadow-glass sm:w-[360px]",
              alignRight ? "sm:left-auto sm:right-0" : "sm:right-auto",
            )}
          >
            {results.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onPointerEnter={() => setHi(i)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm",
                  i === hi ? "bg-[var(--mk-raised)]" : "",
                  current?.id === s.id && "font-semibold",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--mk-text)]">{s.name}</span>
                  <span className="block truncate font-mono text-[11px] text-[var(--mk-muted)]">{s.code}</span>
                </span>
                <span className="shrink-0 rounded-full border border-[var(--mk-border)] px-2 py-0.5 text-[10px] text-[var(--mk-muted)]">{s.group}</span>
              </li>
            ))}
            {!results.length && (
              <li className="px-3 py-4 text-sm text-[var(--mk-muted)]" role="presentation">
                {loading ? "Loading markets…" : `No markets match “${q}”.`}
              </li>
            )}
          </ul>
        )}
      </div>
    );
  },
);
