import "server-only";

import { pushEnabled, sendPush, type PushSender } from "@/lib/push";
import { getStore, type Store } from "@/lib/trading/store";
import type { Book, BrokerAccount, PushDevice, Trade } from "@/lib/trading/types";

/** Local hour (24 h clock) from which the day's summary goes out. */
export const SUMMARY_HOUR = 21;

/** The local calendar date (YYYY-MM-DD) and hour at `at` in a time zone; UTC for an unknown zone. */
export function localTime(at: Date, timeZone: string | null | undefined): { date: string; hour: number } {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone || "UTC");
  } catch {
    parts = fmt("UTC");
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const signed = (n: number, currency: string | null) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}${currency ? ` ${currency}` : ""}`;

/**
 * "Demo: 5 trades closed, 3 won, +12.40 USD · 2 open". One line per book with activity today
 * (real money first); null when nothing closed today and nothing is open.
 */
export function summaryText(closedToday: Trade[], open: Trade[], currencyOf: (book: Book) => string | null): string | null {
  const lines: string[] = [];
  for (const book of ["real", "demo"] as const) {
    const closed = closedToday.filter((t) => t.book === book);
    const stillOpen = open.filter((t) => t.book === book).length;
    if (!closed.length && !stillOpen) continue;
    const parts: string[] = [];
    if (closed.length) {
      const won = closed.filter((t) => t.pnl > 0).length;
      const pnl = closed.reduce((s, t) => s + t.pnl, 0);
      parts.push(`${closed.length} trade${closed.length === 1 ? "" : "s"} closed, ${won} won, ${signed(pnl, currencyOf(book))}`);
    } else {
      parts.push("no trades closed");
    }
    if (stillOpen) parts.push(`${stillOpen} open`);
    lines.push(`${book === "real" ? "Real" : "Demo"}: ${parts.join(" · ")}`);
  }
  return lines.length ? lines.join("\n") : null;
}

let inFlight: Promise<number> | null = null;

/**
 * Each evening (from SUMMARY_HOUR in the device's own time zone) one notification per device
 * that wants it, with the day's results. Run by the scheduler every minute; each device gets at
 * most one per local day. Never throws. Returns how many summaries were sent.
 */
export function runDailySummaries(now = new Date(), opts: { store?: Store; send?: PushSender } = {}): Promise<number> {
  inFlight ??= sendDue(now, opts)
    .catch((error) => {
      console.error("[push] daily summaries failed", error);
      return 0;
    })
    .finally(() => (inFlight = null));
  return inFlight;
}

async function sendDue(now: Date, opts: { store?: Store; send?: PushSender }): Promise<number> {
  if (!opts.send && !pushEnabled()) return 0;
  const store = opts.store ?? getStore();
  let devices: PushDevice[];
  try {
    devices = await store.push_devices.all();
  } catch {
    return 0;
  }
  const due = devices.flatMap((d) => {
    if (d.topics?.summary === false) return [];
    const local = localTime(now, d.timezone);
    return local.hour >= SUMMARY_HOUR && d.summary_sent_on !== local.date ? [{ d, local }] : [];
  });
  let sent = 0;
  const texts = new Map<string, string | null>(); // per user and local date
  for (const { d, local } of due) {
    // Mark first: a slow or failed send must not turn into one summary per minute.
    await store.push_devices.update(d.id, { summary_sent_on: local.date });
    const key = `${d.user_id}|${d.timezone ?? "UTC"}|${local.date}`;
    if (!texts.has(key)) texts.set(key, await textFor(d.user_id, d.timezone, local.date, now, store));
    const body = texts.get(key);
    if (!body) continue; // a quiet day: nothing to report
    sent += await sendPush(d.user_id, null, { title: "Today on binaryTrades", body, url: "/dashboard/trades", tag: "daily-summary" }, { store, send: opts.send, only: d.id });
  }
  return sent;
}

async function textFor(userId: string, timeZone: string | null | undefined, date: string, now: Date, store: Store): Promise<string | null> {
  const since = new Date(now.getTime() - 26 * 3_600_000).toISOString(); // covers any zone's "today"
  const [closed, open, brokers] = await Promise.all([
    store.trades.all({ eq: { user_id: userId, status: "closed" }, since: { field: "closed_at", value: since } }),
    store.trades.all({ eq: { user_id: userId, status: "open" } }),
    store.brokers.all({ eq: { user_id: userId } }),
  ]);
  const today = closed.filter((t) => t.closed_at && localTime(new Date(t.closed_at), timeZone).date === date);
  return summaryText(today, open, (book) => singleCurrency(brokers, book));
}

/** The book's currency when all its accounts share one; otherwise none (amounts are still summed). */
function singleCurrency(brokers: BrokerAccount[], book: Book): string | null {
  const currencies = new Set(brokers.filter((b) => (b.is_demo ? "demo" : "real") === book).map((b) => b.currency).filter(Boolean));
  return currencies.size === 1 ? [...currencies][0]! : null;
}
