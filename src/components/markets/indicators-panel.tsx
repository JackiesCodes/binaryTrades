"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

import {
  INDICATOR_COLORS,
  INDICATOR_TYPES,
  MAX_INDICATORS,
  MAX_PANES,
  SOURCES,
  indicatorLabel,
  isPane,
  newIndicator,
  sanitizeIndicator,
  type IndicatorConfig,
  type IndicatorType,
  type Source,
} from "@/lib/markets/indicators";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-lg border border-[var(--mk-border)] bg-[var(--mk-raised)] px-2.5 text-sm text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]";

/** Add, edit and remove indicators. Lives inside the Markets panel so it follows the chart theme. */
export function IndicatorsPanel({
  indicators,
  onChange,
  onClose,
  editId,
}: {
  indicators: IndicatorConfig[];
  onChange: (next: IndicatorConfig[]) => void;
  onClose: () => void;
  /** Open this indicator's settings straight away. */
  editId?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(editId ?? null);
  const panel = useRef<HTMLDivElement>(null);
  const panes = indicators.filter(isPane).length;
  const full = indicators.length >= MAX_INDICATORS;

  useEffect(() => setOpen(editId ?? null), [editId]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const add = (type: IndicatorType) => {
    const c = newIndicator(type, indicators);
    onChange([...indicators, c]);
    setOpen(c.id);
  };
  const update = (id: string, patch: Partial<IndicatorConfig>) =>
    onChange(indicators.map((c) => (c.id === id ? (sanitizeIndicator({ ...c, ...patch }) ?? c) : c)));
  const remove = (id: string) => onChange(indicators.filter((c) => c.id !== id));

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Indicators"
      className="scrollbar-thin absolute inset-x-2 bottom-2 z-40 max-h-[75%] overflow-y-auto rounded-2xl border border-[var(--mk-border)] bg-[var(--mk-panel)] p-3 shadow-glass sm:inset-x-auto sm:bottom-auto sm:right-2 sm:top-2 sm:max-h-[calc(100%-1rem)] sm:w-[320px]"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--mk-text)]">Indicators</h2>
        <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-text)]" aria-label="Close indicators">
          <X className="h-4 w-4" />
        </button>
      </div>

      {indicators.length > 0 ? (
        <ul className="mb-3 space-y-1.5">
          {indicators.map((c) => {
            const isOpen = open === c.id;
            return (
              <li key={c.id} className="rounded-xl border border-[var(--mk-border)] bg-[var(--mk-bg)]">
                <div className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
                  <button
                    type="button"
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-1 text-left text-sm font-medium text-[var(--mk-text)]"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : c.id)}
                  >
                    <span className="truncate">{indicatorLabel(c)}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-[var(--mk-muted)] transition-transform", isOpen && "rotate-180")} aria-hidden />
                    <span className="sr-only">settings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-down)]"
                    aria-label={`Remove ${indicatorLabel(c)}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {isOpen && <Settings c={c} onPatch={(p) => update(c.id, p)} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-[var(--mk-muted)]">No indicators yet. Add one below.</p>
      )}

      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--mk-muted)]">Add</div>
      <ul className="mt-1.5 grid gap-1">
        {INDICATOR_TYPES.map((t) => {
          const paneFull = t.pane && panes >= MAX_PANES;
          const disabled = full || paneFull;
          return (
            <li key={t.type}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => add(t.type)}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-[var(--mk-raised)] disabled:cursor-not-allowed disabled:opacity-50"
                title={paneFull ? `Up to ${MAX_PANES} indicator panes` : full ? `Up to ${MAX_INDICATORS} indicators` : undefined}
              >
                <Plus className="h-4 w-4 shrink-0 text-[var(--mk-accent)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-[var(--mk-text)]">
                    {t.name} <span className="font-mono text-xs text-[var(--mk-muted)]">{t.short}</span>
                  </span>
                  <span className="block text-xs text-[var(--mk-muted)]">
                    {t.about}
                    {t.pane ? " · own pane" : " · on the chart"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-[var(--mk-muted)]">Indicators use the real candles, also in Heikin-Ashi view.</p>
    </div>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  // Keep what's typed until it's a valid number, so "1" on the way to "14" isn't clamped away.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium text-[var(--mk-muted)]">{label}</span>
      <input
        className={field}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

function Settings({ c, onPatch }: { c: IndicatorConfig; onPatch: (p: Partial<IndicatorConfig>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 border-t border-[var(--mk-border)] p-2.5">
      {c.type === "macd" ? (
        <>
          <NumberField label="Fast" value={c.fast ?? 12} min={1} max={200} onChange={(v) => onPatch({ fast: v })} />
          <NumberField label="Slow" value={c.slow ?? 26} min={2} max={400} onChange={(v) => onPatch({ slow: v })} />
          <NumberField label="Signal" value={c.signal ?? 9} min={1} max={200} onChange={(v) => onPatch({ signal: v })} />
        </>
      ) : (
        <NumberField label="Period" value={c.period} min={1} max={500} onChange={(v) => onPatch({ period: v })} />
      )}
      {c.type === "bb" && <NumberField label="Std. deviations" value={c.mult ?? 2} min={0.1} max={10} step={0.1} onChange={(v) => onPatch({ mult: v })} />}
      <label className="grid gap-1">
        <span className="text-[11px] font-medium text-[var(--mk-muted)]">Source</span>
        <select className={field} value={c.source} onChange={(e) => onPatch({ source: e.target.value as Source })}>
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="col-span-2 grid gap-1">
        <legend className="mb-1 text-[11px] font-medium text-[var(--mk-muted)]">Colour</legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {INDICATOR_COLORS.map((col) => (
            <button
              key={col}
              type="button"
              onClick={() => onPatch({ color: col })}
              className={cn("h-7 w-7 rounded-full border-2", c.color.toLowerCase() === col.toLowerCase() ? "border-[var(--mk-text)]" : "border-transparent")}
              style={{ background: col }}
              aria-label={`Colour ${col}`}
              aria-pressed={c.color.toLowerCase() === col.toLowerCase()}
            />
          ))}
          <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full border border-[var(--mk-border)]" title="Custom colour">
            <span className="sr-only">Custom colour</span>
            <input type="color" value={c.color} onChange={(e) => onPatch({ color: e.target.value })} className="absolute -inset-2 h-11 w-11 cursor-pointer" />
          </label>
        </div>
      </fieldset>
    </div>
  );
}
