"use client";

import type { Bucket } from "@/lib/trading/performance";
import { cn } from "@/lib/utils";

export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** P&L per bucket as bars above (profit) or below (loss) a zero line; hover or tap a bar for details. */
export function PnlBars({ title, buckets, labels, tick, fmt }: { title: string; buckets: Bucket[]; labels: string[]; tick: (i: number) => boolean; fmt: (n: number) => string }) {
  const max = Math.max(...buckets.map((b) => Math.abs(b.pnl)), 0.01);
  const worst = buckets.reduce((w, b, i) => (b.trades && b.pnl < (buckets[w]?.pnl ?? 0) ? i : w), -1);
  const name = (i: number) => (labels.length === 24 ? `${labels[i]}:00` : labels[i]);
  const best = buckets.reduce((w, b, i) => (b.trades && b.pnl > (buckets[w]?.pnl ?? 0) ? i : w), -1);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-muted-foreground">
        <span>{title}</span>
        <span>
          {best >= 0 && <>best {name(best)} <b className="font-mono text-profit">{fmt(buckets[best]!.pnl)}</b></>}
          {best >= 0 && worst >= 0 && " · "}
          {worst >= 0 && <>worst {name(worst)} <b className="font-mono text-loss">{fmt(buckets[worst]!.pnl)}</b></>}
        </span>
      </figcaption>
      <div className="flex h-20 items-stretch gap-0.5 rounded-lg bg-black/25 px-1.5 py-1" role="img" aria-label={`${title}: profit or loss by ${labels.length === 24 ? "hour" : "day"}`}>
        {buckets.map((b, i) => {
          const pct = (Math.abs(b.pnl) / max) * 50;
          return (
            <div
              key={i}
              className="relative flex-1"
              title={`${name(i)} · ${b.trades ? `${b.trades} trade${b.trades === 1 ? "" : "s"}, ${b.wins} won · ${fmt(b.pnl)}` : "no trades"}`}
            >
              <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
              {b.trades > 0 && (
                <div
                  className={cn("absolute inset-x-0", b.pnl >= 0 ? "bg-profit" : "bg-loss")}
                  style={b.pnl >= 0 ? { bottom: "50%", height: `${Math.max(pct, 2)}%` } : { top: "50%", height: `${Math.max(pct, 2)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 px-1.5 text-[10px] text-muted-foreground" aria-hidden>
        {labels.map((l, i) => (
          <span key={i} className="flex-1 text-center">
            {tick(i) ? l : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

export const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

