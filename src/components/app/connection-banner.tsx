"use client";

import { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { updatedLabel } from "@/lib/client";

/** Failed refreshes in a row before we say so (one blip on a train isn't worth a banner). */
export const FAILURES_BEFORE_BANNER = 2;

/**
 * Says when the numbers on screen may be out of date: the device is offline, or the site hasn't
 * answered for a while. Bots run on the server either way, so it says that too.
 */
export function ConnectionBanner() {
  const { online, failures, updatedAt, refresh } = useDashboard();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const show = !online || failures >= FAILURES_BEFORE_BANNER;

  useEffect(() => {
    if (!show) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [show]);

  if (!show) return null;
  const when = updatedLabel(updatedAt, now);
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/10 px-3.5 py-2.5 text-sm text-ivory"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-gold" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        <b className="font-semibold">{online ? "Can't reach binaryTrades." : "You're offline."}</b>{" "}
        <span className="text-muted-foreground">
          Figures last updated {when}. Your bots keep running on the server.
        </span>
      </p>
      {online && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await refresh();
            setBusy(false);
          }}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
          Retry
        </button>
      )}
    </div>
  );
}
