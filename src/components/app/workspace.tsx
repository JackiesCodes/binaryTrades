"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, LineChart, X } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { api, money, price } from "@/lib/client";
import type { Trade } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

/**
 * Page layout: a header strip and the main column on the left, the page's
 * controls in a panel on the right (below the main column on smaller screens).
 */
export function Workspace({
  strip,
  aside,
  children,
  asideFirstOnPhone = false,
}: {
  strip?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** Show the side panel above the main column on phones (e.g. a form that is the page's main job). */
  asideFirstOnPhone?: boolean;
}) {
  // When the side panel goes first on phones, the header strip still leads the page: it is drawn
  // above everything there, and inside the main column on wide screens.
  const stripFirst = asideFirstOnPhone && strip;
  return (
    <div className={cn("grid items-start gap-3.5", aside && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
      {stripFirst && <div className="min-w-0 xl:hidden">{strip}</div>}
      <div className={cn("flex min-w-0 flex-col gap-3.5", asideFirstOnPhone && "order-2 xl:order-1")}>
        {stripFirst ? <div className="hidden min-w-0 xl:block">{strip}</div> : strip}
        {children}
      </div>
      {aside && (
        <aside
          className={cn(
            "scrollbar-thin flex min-w-0 flex-col gap-3.5 rounded-[18px] bg-panel p-4 [&>*]:shrink-0 xl:sticky xl:top-[calc(var(--header-h,64px)+12px)] xl:max-h-[calc(100dvh-var(--header-h,64px)-24px)] xl:overflow-y-auto",
            asideFirstOnPhone && "order-1 xl:order-2",
          )}
        >
          {aside}
        </aside>
      )}
    </div>
  );
}

/** The header strip: who/what this page is about, then its key numbers. */
export function Strip({
  icon: Icon,
  title,
  sub,
  stats,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  sub?: React.ReactNode;
  stats: Array<{ label: string; value: React.ReactNode; tone?: string; className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-[18px] bg-panel p-4 md:flex-row md:items-center md:gap-6 md:px-5">
      <div className="flex min-w-0 items-center gap-3 md:shrink-0 md:border-r md:border-white/[0.06] md:pr-6">
        <IconTile icon={Icon} />
        <div className="min-w-0">
          <div className="truncate font-bold text-ivory">{title}</div>
          {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
        </div>
        {action && <div className="ml-auto md:hidden">{action}</div>}
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 md:flex md:flex-wrap md:gap-x-7">
        {stats.map((s) => (
          <div key={s.label} className={cn("min-w-0", s.className)}>
            <dt className="truncate text-xs text-muted-foreground">{s.label}</dt>
            <dd className={cn("truncate font-mono text-[15px] font-medium tabular-nums text-ivory", s.tone)}>{s.value}</dd>
          </div>
        ))}
      </dl>
      {action && <div className="hidden md:block">{action}</div>}
    </section>
  );
}

export function IconTile({
  icon: Icon,
  tone = "profit",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: "profit" | "gold" | "loss" | "muted";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.06]",
        tone === "profit" && "text-profit",
        tone === "gold" && "text-gold",
        tone === "loss" && "text-loss",
        tone === "muted" && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Title inside the right panel. */
export function AsideTitle({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-ivory">
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </h2>
  );
}

/** Label / value rows (right panel summaries). */
export function KV({ rows }: { rows: Array<[React.ReactNode, React.ReactNode, string?]> }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([k, v, tone], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cn("whitespace-nowrap font-mono tabular-nums text-ivory", tone)}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A darker box that groups form fields in the right panel. */
export function FieldBox({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 rounded-[14px] bg-black/25 p-3", className)}>{children}</div>;
}

/** Tab / filter switch in the reference style. Green when `accent`. */
export function Switcher<T extends string>({
  value,
  options,
  onChange,
  accent = true,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: React.ReactNode; tone?: "gold" | "loss" }>;
  onChange: (value: T) => void;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("grid gap-1 rounded-xl bg-black/30 p-1 text-[13px]", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "truncate rounded-[9px] px-2 py-2 font-medium transition-colors",
              on
                ? o.tone === "gold"
                  ? "bg-gold text-ink"
                  : o.tone === "loss"
                    ? "bg-loss text-white"
                    : accent
                      ? "bg-profit font-semibold text-ink"
                      : "bg-white/[0.08] text-ivory"
                : "text-muted-foreground hover:text-ivory",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small range pills (1D 7D 1M…). */
export function RangePills<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            o === value ? "border-profit bg-profit text-ink" : "border-white/10 text-muted-foreground hover:text-ivory",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** Tiny trend line of cumulative P&L. */
export function Spark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <div className={cn("h-7", className)} />;
  const w = 200;
  const h = 28;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const span = mx - mn || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - mn) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden>
      <path d={d} fill="none" stroke={up ? "#85BB65" : "#D9634F"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Cumulative P&L of closed trades, oldest first. */
export function cumulative(trades: Trade[]): number[] {
  const closed = trades.filter((t) => t.status === "closed" && t.closed_at).sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!));
  let sum = 0;
  return [0, ...closed.map((t) => (sum += t.pnl))];
}

function sizeLabel(t: Trade) {
  if (t.status === "pending") return "pending";
  if (t.size_unit === "stake") return money(t.size);
  if (t.size_unit === "lots") return `${t.size} lots`;
  return `${t.size.toFixed(2)} u`;
}

function pctFrom(entry: number | null, p: number | null) {
  if (!entry || !p) return null;
  const v = ((p - entry) / entry) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 1 ? 2 : 1)}%`;
}

/**
 * One trade as a card: bot, market, side, stake, entry, then a stop · price · target bar
 * with the P&L. Works for open and closed trades.
 */
export function PositionCard({ trade: t, onChart }: { trade: Trade; onChart?: (t: Trade) => void }) {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [closing, setClosing] = useState(false);
  const bot = t.bot_id ? state?.bots.find((b) => b.id === t.bot_id) : undefined;
  const broker = t.broker_account_id ? state?.brokers.find((b) => b.id === t.broker_account_id) : undefined;
  const open = t.status === "open" || t.status === "pending";
  const now = open ? t.current_price : t.exit_price;
  const up = t.pnl >= 0;
  const dir = t.side === "buy" ? 1 : -1;

  // Where the price sits between stop (0%) and target (100%).
  let fill: number | null = null;
  if (t.sl && t.tp && now) {
    const r = (now - t.sl) / (t.tp - t.sl);
    fill = Math.min(1, Math.max(0, r)) * 100;
  }
  const entryAt = t.sl && t.tp && t.entry_price ? Math.min(100, Math.max(0, ((t.entry_price - t.sl) / (t.tp - t.sl)) * 100)) : 50;

  const close = async () => {
    const ok = await confirm({
      title: `Close ${t.side.toUpperCase()} ${t.symbol}?`,
      description: t.book === "real" ? "This closes a real-money position at the current market price." : "Closes this demo-account position at the current market price.",
      confirmLabel: "Close position",
      danger: t.book === "real",
    });
    if (!ok) return;
    setClosing(true);
    try {
      await api(`/api/trades/${t.id}/close`, "POST");
      await refresh();
      toast(`${t.symbol} close sent`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setClosing(false);
    }
  };

  const status = open
    ? { label: t.status === "pending" ? "Pending" : "Open", cls: "bg-sky-400/15 text-sky-300" }
    : t.status === "rejected"
      ? { label: "Rejected", cls: "bg-loss/15 text-loss" }
      : { label: `Closed${t.close_reason ? ` · ${t.close_reason.split(" · ")[0]}` : ""}`, cls: up ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss" };

  return (
    <article className="grid gap-3 rounded-[18px] bg-panel p-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,300px)_auto] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="truncate font-bold text-ivory">{bot?.name ?? (t.external ? "Other EA / manual" : t.symbol)}</span>
          <span className="text-muted-foreground">· {t.symbol}</span>
          <span className={cn("max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium", status.cls)}>{status.label}</span>
          {t.book === "real" && <span className="rounded-md bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">REAL</span>}
        </div>
        <dl className="mt-2 grid grid-cols-4 gap-x-4 text-xs sm:w-fit sm:gap-x-6">
          {[
            ["Side", <span key="s" className={cn("font-sans font-semibold", t.side === "buy" ? "text-profit" : "text-loss")}>{t.side === "buy" ? "Buy" : "Sell"}</span>],
            ["Stake", sizeLabel(t)],
            ["Entry", price(t.entry_price)],
            ["Risk", money(t.risk_amount, broker?.currency)],
          ].map(([k, v], i) => (
            <div key={i} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="truncate font-mono text-sm tabular-nums text-ivory">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="min-w-0 text-[11px] text-muted-foreground">
        <div className="flex justify-between">
          <span>{t.sl ? `(${pctFrom(t.entry_price, t.sl)})` : ""}</span>
          <span>{t.tp ? `(${pctFrom(t.entry_price, t.tp)})` : ""}</span>
        </div>
        <div className="flex justify-between gap-2 font-mono text-[13px] tabular-nums text-ivory">
          <span>{price(t.sl)}</span>
          <span>{price(now)}</span>
          <span>{price(t.tp)}</span>
        </div>
        <div className="relative my-1.5 h-1 rounded-full bg-white/[0.08]">
          {fill !== null && (
            <span
              className={cn("absolute inset-y-0 rounded-full", up ? "bg-profit" : "bg-loss")}
              style={{ left: `${Math.min(entryAt, fill)}%`, width: `${Math.abs(fill - entryAt)}%` }}
            />
          )}
          <span className="absolute -top-[3px] h-2.5 w-0.5 rounded bg-ivory" style={{ left: `${entryAt}%` }} aria-hidden />
        </div>
        <div className="flex justify-between gap-2">
          <span>Stop</span>
          <span>
            P&amp;L{" "}
            <b className={cn("font-mono font-semibold", up ? "text-profit" : "text-loss")}>{money(t.pnl, broker?.currency, true)}</b>
            {t.entry_price && now ? ` (${pctFrom(t.entry_price, t.entry_price + dir * (now - t.entry_price))})` : ""}
          </span>
          <span>Target</span>
        </div>
      </div>

      <div className="flex gap-1 text-muted-foreground md:flex-col">
        {onChart && (
          <button onClick={() => onChart(t)} className="rounded-lg p-1.5 hover:bg-white/[0.06] hover:text-ivory" aria-label="Show on chart" title="Show on chart">
            <LineChart className="h-4 w-4" />
          </button>
        )}
        {bot && (
          <Link href={`/dashboard/bots/${bot.id}`} className="rounded-lg p-1.5 hover:bg-white/[0.06] hover:text-ivory" aria-label="Open bot" title="Open bot">
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
        {open && (
          <button
            onClick={close}
            disabled={closing || Boolean(t.close_reason)}
            className="rounded-lg p-1.5 hover:bg-loss/10 hover:text-loss disabled:opacity-40"
            aria-label="Close position"
            title="Close position"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  );
}
