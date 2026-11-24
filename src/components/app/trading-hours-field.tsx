"use client";

import { selectClass } from "@/components/app/widgets";
import { WEEKDAYS, hoursLabel, type TradingHours } from "@/lib/trading/hours";
import { cn } from "@/lib/utils";

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Only trade during set hours": when the bot may open new trades. */
export function TradingHoursField({ value, onChange }: { value: TradingHours | null; onChange: (v: TradingHours | null) => void }) {
  const on = value !== null;
  return (
    <div className="grid gap-2">
      <label className="flex min-h-10 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? { from: 8, to: 20, days: [1, 2, 3, 4, 5], tz: browserZone() } : null)}
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
          <span className="block text-sm text-ivory">Only trade during set hours</span>
          <span className="block text-xs text-muted-foreground">
            {on ? `Opens trades ${hoursLabel(value)}. Outside these it still manages and closes its trades.` : "Opens trades whenever its strategy says so."}
          </span>
        </span>
      </label>
      {on && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(["from", "to"] as const).map((k) => (
              <label key={k} className="grid gap-1">
                <span className="text-xs text-muted-foreground">{k === "from" ? "From" : "Until"}</span>
                <select
                  className={selectClass}
                  value={k === "to" && value.to === 0 ? 24 : value[k]}
                  onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) % 24 })}
                >
                  {Array.from({ length: k === "from" ? 24 : 25 }, (_, h) => h)
                    .filter((h) => k === "from" || h > 0)
                    .map((h) => (
                      <option key={h} value={h}>
                        {hh(h)}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <div role="group" aria-label="Days" className="grid grid-cols-7 gap-1">
            {MON_FIRST.map((d) => {
              const picked = value.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    const days = picked ? value.days.filter((x) => x !== d) : [...value.days, d].sort();
                    if (days.length) onChange({ ...value, days });
                  }}
                  className={cn(
                    "h-10 rounded-lg text-xs font-medium lg:h-8",
                    picked ? "bg-profit text-ink" : "bg-black/30 text-muted-foreground hover:text-ivory",
                  )}
                >
                  {WEEKDAYS[d]}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Times are in {value.tz.replace(/_/g, " ")}
            {value.tz !== browserZone() && (
              <>
                {" "}
                ·{" "}
                <button type="button" className="font-semibold text-profit hover:underline" onClick={() => onChange({ ...value, tz: browserZone() })}>
                  use {browserZone().replace(/_/g, " ")}
                </button>
              </>
            )}
            . Until 24:00 means midnight; an earlier &ldquo;until&rdquo; than &ldquo;from&rdquo; runs overnight.
          </p>
        </>
      )}
    </div>
  );
}
