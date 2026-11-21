"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Trash2, X } from "lucide-react";

import { formatPrice, priceDecimals } from "@/lib/markets/bars";
import { MAX_ACTIVE_ALERTS, activeAlerts, alertProblem, newAlert, suggestedOp, type PriceAlert } from "@/lib/markets/alerts";
import type { MarketSymbol } from "@/lib/markets/symbols";
import { cn } from "@/lib/utils";

const field =
  "h-10 w-full rounded-lg border border-[var(--mk-border)] bg-[var(--mk-raised)] px-2.5 text-sm text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)]";

type Permission = NotificationPermission | "unsupported";
const permissionNow = (): Permission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

/** Set, list and remove price alerts. Lives inside the Markets panel so it follows the chart theme. */
export function AlertsPanel({
  alerts,
  onChange,
  onClose,
  current,
  price,
  decimals,
  nameOf,
  onPick,
}: {
  alerts: PriceAlert[];
  onChange: (next: PriceAlert[]) => void;
  onClose: () => void;
  /** The chart's market: new alerts are set on it. */
  current: MarketSymbol | null;
  price: number | null;
  decimals: number;
  nameOf: (id: string) => string;
  onPick: (id: string) => void;
}) {
  const [level, setLevel] = useState(() => (price !== null ? price.toFixed(decimals) : ""));
  const [op, setOp] = useState<PriceAlert["op"]>("above");
  const [touchedOp, setTouchedOp] = useState(false);
  const [edited, setEdited] = useState(false); // the prefilled current price is only a starting point
  const [email, setEmail] = useState(true);
  useEffect(() => {
    try {
      setEmail(localStorage.getItem("bt.markets.alertEmail") !== "0");
    } catch {
      // keep the default
    }
  }, []);
  const changeEmail = (on: boolean) => {
    setEmail(on);
    try {
      localStorage.setItem("bt.markets.alertEmail", on ? "1" : "0");
    } catch {
      // not remembered
    }
  };
  const [permission, setPermission] = useState<Permission>("default");
  const panel = useRef<HTMLDivElement>(null);
  const active = activeAlerts(alerts);
  const fired = alerts.filter((a) => a.triggered_at);
  const value = Number(level);
  const problem = level.trim() === "" ? null : alertProblem(op, value, price);
  const full = active.length >= MAX_ACTIVE_ALERTS;

  useEffect(() => setPermission(permissionNow()), []);
  // Follow the typed level with the obvious direction, until the user picks one.
  useEffect(() => {
    if (!touchedOp && Number.isFinite(value) && value > 0) setOp(suggestedOp(value, price));
  }, [value, price, touchedOp]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!current || problem || !(value > 0) || full) return;
    onChange([newAlert(current.id, op, value, new Date(), email), ...alerts]);
    setTouchedOp(false);
  };

  const allow = async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  };

  const fmt = (id: string, p: number) => formatPrice(p, priceDecimals(p, id === current?.id ? current.pipSize : undefined));
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Price alerts"
      className="scrollbar-thin absolute inset-x-2 bottom-2 z-40 max-h-[80%] overflow-y-auto rounded-2xl border border-[var(--mk-border)] bg-[var(--mk-panel)] p-3 shadow-glass sm:inset-x-auto sm:bottom-auto sm:right-2 sm:top-2 sm:max-h-[calc(100%-1rem)] sm:w-[340px]"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--mk-text)]">Price alerts</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-text)]"
          aria-label="Close alerts"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={add} className="grid gap-2 rounded-xl border border-[var(--mk-border)] bg-[var(--mk-bg)] p-2.5">
        <div className="text-xs text-[var(--mk-muted)]">
          New alert on <span className="font-semibold text-[var(--mk-text)]">{current?.name ?? "—"}</span>
          {price !== null && <span className="font-mono"> · now {formatPrice(price, decimals)}</span>}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <div role="radiogroup" aria-label="When the price goes" className="flex rounded-lg border border-[var(--mk-border)] p-0.5">
            {(["above", "below"] as const).map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={op === o}
                onClick={() => {
                  setOp(o);
                  setTouchedOp(true);
                }}
                className={cn(
                  "h-8 rounded-md px-2.5 text-xs font-semibold capitalize",
                  op === o ? "bg-[var(--mk-raised)] text-[var(--mk-text)]" : "text-[var(--mk-muted)]",
                )}
              >
                {o}
              </button>
            ))}
          </div>
          <label>
            <span className="sr-only">Alert price</span>
            <input
              className={field}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="Price"
              value={level}
              onChange={(e) => {
                setLevel(e.target.value);
                setEdited(true);
              }}
              aria-invalid={Boolean(problem && edited)}
            />
          </label>
        </div>
        {problem && edited && (
          <p className="text-xs text-[var(--mk-down)]" role="alert">
            {problem}
          </p>
        )}
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-[var(--mk-text)]">
          <input type="checkbox" checked={email} onChange={(e) => changeEmail(e.target.checked)} className="h-4 w-4 accent-[var(--mk-accent)]" />
          Also email me when it fires
        </label>
        <button
          type="submit"
          disabled={!current || Boolean(problem) || !(value > 0) || full}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[var(--mk-accent)] text-sm font-semibold text-[var(--mk-bg)] disabled:opacity-50"
        >
          <Bell className="h-4 w-4" /> Add alert
        </button>
        {full && <p className="text-xs text-[var(--mk-muted)]">Up to {MAX_ACTIVE_ALERTS} waiting alerts.</p>}
      </form>

      <div className="mt-2 rounded-xl px-1 py-1.5 text-xs text-[var(--mk-muted)]">
        {permission === "granted" ? (
          <span>Browser notifications are on.</span>
        ) : permission === "denied" ? (
          <span className="inline-flex items-center gap-1.5">
            <BellOff className="h-3.5 w-3.5" /> Browser notifications are blocked for this site; alerts still show here.
          </span>
        ) : permission === "unsupported" ? (
          <span>This browser can&apos;t show notifications; alerts show here.</span>
        ) : (
          <button type="button" onClick={allow} className="font-semibold text-[var(--mk-accent)] underline-offset-2 hover:underline">
            Also notify me in the browser
          </button>
        )}
        <span className="block">
          Checked every minute on our server, also with the site closed. Fired alerts are listed in Alerts &amp; Logs and emailed to your account&apos;s address
          if you ticked the box.
        </span>
      </div>

      <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--mk-muted)]">Waiting ({active.length})</h3>
      {active.length ? (
        <ul className="mt-1 space-y-1">
          {active.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-xl border border-[var(--mk-border)] bg-[var(--mk-bg)] py-1 pl-2.5 pr-1">
              <button type="button" className="min-h-10 min-w-0 flex-1 text-left text-sm" onClick={() => onPick(a.symbol)} title="Open this market">
                <span className="block truncate text-[var(--mk-text)]">{nameOf(a.symbol)}</span>
                <span className="block font-mono text-[11px] text-[var(--mk-muted)]">
                  {a.op === "above" ? "▲ above" : "▼ below"} {fmt(a.symbol, a.price)}
                  {a.email !== false && " · email"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onChange(alerts.filter((x) => x.id !== a.id))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:text-[var(--mk-down)]"
                aria-label={`Remove alert ${nameOf(a.symbol)} ${a.op} ${a.price}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-[var(--mk-muted)]">No alerts waiting.</p>
      )}

      {fired.length > 0 && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--mk-muted)]">Fired</h3>
            <button
              type="button"
              onClick={() => onChange(active)}
              className="text-xs text-[var(--mk-muted)] underline-offset-2 hover:text-[var(--mk-text)] hover:underline"
            >
              Clear
            </button>
          </div>
          <ul className="mt-1 space-y-1">
            {fired.map((a) => (
              <li key={a.id} className="rounded-xl px-2.5 py-1.5 text-xs text-[var(--mk-muted)]">
                <span className="text-[var(--mk-text)]">{nameOf(a.symbol)}</span> {a.op} {fmt(a.symbol, a.price)} · {when(a.triggered_at!)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
