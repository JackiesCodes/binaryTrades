"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { riskLabel } from "@/components/app/bot-parts";
import { formatPrice, type Bar } from "@/lib/markets/bars";
import { STOP_ATR, TARGET_RR, levelsProblem, suggestLevels } from "@/lib/markets/trade-plan";
import type { Bot } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

const field =
  // 16px text on phones so the browser doesn't zoom in when a field is tapped.
  "h-11 w-full rounded-lg border border-[var(--mk-border)] bg-[var(--mk-raised)] px-2.5 text-base text-[var(--mk-text)] outline-none focus:border-[var(--mk-accent)] lg:h-10 lg:text-sm";

export interface TradeBot {
  bot: Bot;
  accountLabel: string;
  isDemo: boolean;
  currency: string;
}

/**
 * Place a trade from the chart through one of the user's bots on this market. Same path as the bot
 * page's Manual tab: Risk Guard, the bot's risk setting, always confirmed (in red for real money).
 */
export function TradePanel({
  bots,
  marketName,
  price,
  decimals,
  getBars,
  onClose,
}: {
  bots: TradeBot[];
  marketName: string;
  price: number | null;
  decimals: number;
  getBars: () => Bar[];
  onClose: () => void;
}) {
  const { refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  // Demo bots first, so the safe choice is the default.
  const ordered = [...bots].sort((a, b) => Number(b.isDemo) - Number(a.isDemo));
  const [botId, setBotId] = useState(ordered[0]?.bot.id ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const chosen = ordered.find((b) => b.bot.id === botId) ?? ordered[0];

  // Suggested stop / target (the bots' usual 2 × ATR rule) until the user types their own.
  useEffect(() => {
    if (edited || price === null) return;
    const s = suggestLevels(getBars(), side, price);
    setStop(s ? s.stop.toFixed(decimals) : "");
    setTarget(s ? s.target.toFixed(decimals) : "");
  }, [side, price === null, edited]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("select, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const sl = num(stop);
  const tp = num(target);
  const levelsError =
    (sl !== null && !Number.isFinite(sl)) || (tp !== null && !Number.isFinite(tp))
      ? "Enter the stop and target as numbers."
      : levelsProblem(side, price, sl, tp);

  const send = async (action: "buy" | "sell" | "close") => {
    if (!chosen) return;
    const { bot, accountLabel, isDemo, currency } = chosen;
    const verb = action === "close" ? "Close" : action === "buy" ? "Buy" : "Sell";
    const levels =
      action === "close" ? "" : ` Stop ${sl !== null ? formatPrice(sl, decimals) : "none"} · target ${tp !== null ? formatPrice(tp, decimals) : "none"}.`;
    const ok = await confirm({
      title: action === "close" ? `Close ${bot.name}'s trades?` : `${verb} ${marketName} with ${bot.name}?`,
      description: `${isDemo ? "Demo" : "REAL MONEY"} account ${accountLabel}.${levels}${
        action === "close" ? "" : ` Sized by the bot's risk (${riskLabel(bot, currency)} per trade).`
      } Passes through Risk Guard first.`,
      confirmLabel: `${verb} now`,
      danger: !isDemo,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/bots/${bot.id}/signal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "close" ? { action } : { action, sl, tp }),
      });
      const result = (await res.json().catch(() => ({}))) as { status?: string; reason?: string | null };
      await refresh();
      if (result.status === "accepted") {
        toast(action === "close" ? `Closed ${bot.name}'s trades` : `${verb} order placed with ${bot.name}`, "success");
        onClose();
      } else {
        toast(result.reason ?? "Order refused", "error", 8000);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Phones: dim the page behind the sheet; tapping it closes the sheet. */}
      <button type="button" aria-label="Close trade panel" onClick={onClose} className="fixed inset-0 z-[55] bg-black/50 lg:hidden" />
      <div
        ref={panel}
        role="dialog"
        aria-label="Trade"
        // Phones: a bottom sheet over the whole screen's bottom (above the tab bar), large touch targets.
        // Desktop: a panel on the right of the chart.
        className="scrollbar-thin fixed inset-x-0 bottom-0 z-[60] max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--mk-border)] bg-[var(--mk-panel)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-glass lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-2 lg:top-2 lg:z-40 lg:max-h-[calc(100%-1rem)] lg:w-[340px] lg:rounded-2xl lg:border lg:p-3"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--mk-border)] lg:hidden" aria-hidden />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--mk-text)]">Trade {marketName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--mk-muted)] hover:bg-[var(--mk-raised)] hover:text-[var(--mk-text)]"
            aria-label="Close trade panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-2.5">
          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-[var(--mk-muted)]">Bot (its account and risk are used)</span>
            <select className={field} value={chosen?.bot.id ?? ""} onChange={(e) => setBotId(e.target.value)}>
              {ordered.map((b) => (
                <option key={b.bot.id} value={b.bot.id}>
                  {b.bot.name} · {b.isDemo ? "Demo" : "REAL"}
                  {b.bot.status === "running" ? "" : " (paused)"}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <div
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px]",
                chosen.isDemo ? "bg-[var(--mk-raised)] text-[var(--mk-muted)]" : "bg-[var(--mk-down)]/15 text-[var(--mk-down)]",
              )}
            >
              {chosen.isDemo ? "Demo account" : "Real money"} {chosen.accountLabel} · risk {riskLabel(chosen.bot, chosen.currency)} per trade
              {chosen.bot.status !== "running" && " · this bot is paused, so Risk Guard will refuse orders until you start it"}
            </div>
          )}

          <div role="radiogroup" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--mk-border)] p-0.5">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => setSide(s)}
                className={cn(
                  "h-11 rounded-md text-base font-semibold capitalize lg:h-9 lg:text-sm",
                  side === s ? (s === "buy" ? "bg-[var(--mk-up)] text-[var(--mk-bg)]" : "bg-[var(--mk-down)] text-[var(--mk-bg)]") : "text-[var(--mk-muted)]",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["Stop", stop, setStop],
                ["Target", target, setTarget],
              ] as const
            ).map(([label, value, setValue]) => (
              <label key={label} className="grid gap-1">
                <span className="text-[11px] font-medium text-[var(--mk-muted)]">{label} (optional)</span>
                <input
                  className={field}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setEdited(true);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-[var(--mk-muted)]">
            {edited ? "Your own levels." : `Suggested: stop ${STOP_ATR} × ATR away, target ${TARGET_RR} × the stop distance.`}
            {price !== null && ` Price now ${formatPrice(price, decimals)}.`}
            {edited && (
              <button type="button" className="ml-1 font-semibold text-[var(--mk-accent)] hover:underline" onClick={() => setEdited(false)}>
                Use the suggestion
              </button>
            )}
          </p>
          {levelsError && (
            <p className="text-xs text-[var(--mk-down)]" role="alert">
              {levelsError}
            </p>
          )}

          <button
            type="button"
            disabled={busy || !chosen || Boolean(levelsError)}
            onClick={() => send(side)}
            className={cn(
              "h-12 rounded-xl text-base font-bold text-[var(--mk-bg)] disabled:opacity-50 lg:h-11 lg:rounded-lg lg:text-sm",
              side === "buy" ? "bg-[var(--mk-up)]" : "bg-[var(--mk-down)]",
            )}
          >
            {side === "buy" ? "Buy" : "Sell"} {marketName}
          </button>
          <button
            type="button"
            disabled={busy || !chosen}
            onClick={() => send("close")}
            className="h-11 rounded-lg border border-[var(--mk-border)] text-sm font-semibold text-[var(--mk-muted)] hover:text-[var(--mk-text)] disabled:opacity-50 lg:h-9 lg:text-xs"
          >
            Close this bot&apos;s trades
          </button>
        </div>
      </div>
    </>
  );
}
