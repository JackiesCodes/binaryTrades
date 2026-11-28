"use client";

import { Input } from "@/components/ui/input";
import type { TrailConfig } from "@/lib/trading/trail";
import { cn } from "@/lib/utils";

/** "$20" from a number of R and the risk per trade, or "" without a fixed amount. */
function inMoney(r: number, riskAmount: number | null | undefined, currency: string): string {
  if (!riskAmount) return "";
  const v = r * riskAmount;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return currency === "USD" ? ` ($${text})` : ` (${text} ${currency})`;
}

/**
 * "Protect profits": move the stop to break-even and trail it behind the best price. Distances are
 * in multiples of the trade's own stop distance; with a fixed $ risk they're also shown in money.
 */
export function TrailField({
  value,
  onChange,
  riskAmount,
  currency = "USD",
}: {
  value: TrailConfig | null;
  onChange: (v: TrailConfig | null) => void;
  riskAmount?: number | null;
  currency?: string;
}) {
  const on = value !== null;
  const set = (patch: Partial<TrailConfig>) => value && onChange({ ...value, ...patch });
  return (
    <div className="grid gap-2">
      <label className="flex min-h-10 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? { start_r: 1, distance_r: 1, no_target: false } : null)}
        />
        <span
          aria-hidden
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-profit",
            on ? "bg-profit" : "bg-white/15",
          )}
        >
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-ivory transition-all", on ? "left-[18px]" : "left-0.5")} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-ivory">Protect profits</span>
          <span className="block text-xs text-muted-foreground">
            {on
              ? `Once a trade is ${value.start_r}× its stop distance in profit${inMoney(value.start_r, riskAmount, currency)}, its stop moves ${
                  value.start_r === value.distance_r ? "to break-even" : "up"
                } and then follows ${value.distance_r}× behind the best price${inMoney(value.distance_r, riskAmount, currency)}. It only moves towards profit.`
              : "Stops stay where they were set: a trade in profit can still go back to a full loss."}
          </span>
        </span>
      </label>
      {on && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Start at profit of (× stop)</span>
              <Input
                id="trail-start"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0.1"
                max="20"
                value={value.start_r}
                onChange={(e) => set({ start_r: Number(e.target.value) })}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Then trail behind by (× stop)</span>
              <Input
                id="trail-distance"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0.1"
                max="20"
                value={value.distance_r}
                onChange={(e) => set({ distance_r: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-ivory">
            <input
              id="trail-no-target"
              type="checkbox"
              checked={Boolean(value.no_target)}
              onChange={(e) => set({ no_target: e.target.checked })}
              className="h-5 w-5 accent-[#85BB65]"
            />
            No take profit: let the trailing stop decide the exit
          </label>
          <p className="text-[11px] text-muted-foreground">
            binaryTrades checks every minute and closes the trade when the price comes back to this stop; your broker keeps the first stop as a
            safety net. See the effect on past candles with Bot on chart in Markets.
          </p>
        </>
      )}
    </div>
  );
}
