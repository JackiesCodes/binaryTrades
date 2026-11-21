import "server-only";

// Price alerts checked on the server once a minute (from the engine tick), so they fire with the
// site closed: the alert is marked fired, a line goes to Alerts & Logs, and an email is sent.

import { appUrl, emailEnabled, priceAlertEmail, sendEmail } from "@/lib/auth/email";
import { withDeriv } from "@/lib/brokers/deriv";
import { activeAlerts, alertHitInCandles, sanitizeAlerts, type MinuteCandle, type PriceAlert } from "@/lib/markets/alerts";
import { formatPrice, priceDecimals } from "@/lib/markets/bars";
import { STARTER_SYMBOLS, marketName, parseSymbolId } from "@/lib/markets/symbols";
import { getStore, log, nowIso } from "@/lib/trading/store";

/** Markets checked per minute at most (the rest wait for a later check). */
const MAX_SYMBOLS = 80;
const BINANCE_REST = "https://data-api.binance.vision"; // public market data; reachable from US servers too

export type FetchRecent = (ids: string[]) => Promise<Map<string, MinuteCandle[]>>;

/** The last few 1-minute candles for each market (missing when a feed doesn't answer). */
export const fetchRecentCandles: FetchRecent = async (ids) => {
  const out = new Map<string, MinuteCandle[]>();
  const parsed = ids.map((id) => ({ id, p: parseSymbolId(id) })).filter((x) => x.p) as Array<{ id: string; p: { provider: string; code: string } }>;
  const binance = parsed.filter((x) => x.p.provider === "binance");
  const deriv = parsed.filter((x) => x.p.provider === "deriv");
  await Promise.all([
    Promise.all(
      binance.map(async ({ id, p }) => {
        try {
          const res = await fetch(`${BINANCE_REST}/api/v3/klines?symbol=${encodeURIComponent(p.code)}&interval=1m&limit=5`, {
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return;
          const rows = (await res.json()) as Array<[number, string, string, string, string]>;
          out.set(
            id,
            rows.map((k) => ({ time: Math.floor(k[0] / 1000), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) })),
          );
        } catch {
          // not this minute
        }
      }),
    ),
    deriv.length
      ? withDeriv(null, async (s) => {
          for (const { id, p } of deriv) {
            try {
              const res = await s.send<{ candles?: Array<Record<string, unknown>> }>({
                ticks_history: p.code,
                style: "candles",
                granularity: 60,
                count: 5,
                end: "latest",
              });
              out.set(
                id,
                (res.candles ?? []).map((c) => ({ time: Number(c.epoch), high: Number(c.high), low: Number(c.low), close: Number(c.close) })),
              );
            } catch {
              // unknown market or no answer: try again next minute
            }
          }
        }).catch(() => undefined)
      : Promise.resolve(),
  ]);
  return out;
};

const pip = (id: string) => STARTER_SYMBOLS.find((s) => s.id === id)?.pipSize;
const fmt = (id: string, p: number) => formatPrice(p, priceDecimals(p, pip(id)));
export function describeFired(a: PriceAlert, reached: number): string {
  return `${marketName(a.symbol)} went ${a.op} ${fmt(a.symbol, a.price)} (reached ${fmt(a.symbol, reached)})`;
}

/** Check every user's waiting alerts against the last minutes of prices; fire the ones reached. */
export async function checkPriceAlerts(fetchRecent: FetchRecent = fetchRecentCandles): Promise<{ waiting: number; fired: number }> {
  const store = getStore();
  const rows = (await store.markets_state.all()).filter((r) => Array.isArray(r.alerts) && r.alerts.length);
  const users = rows.map((row) => ({ row, waiting: activeAlerts(sanitizeAlerts(row.alerts)) })).filter((u) => u.waiting.length);
  const waitingTotal = users.reduce((n, u) => n + u.waiting.length, 0);
  if (!users.length) return { waiting: 0, fired: 0 };

  const symbols = [...new Set(users.flatMap((u) => u.waiting.map((a) => a.symbol)))].slice(0, MAX_SYMBOLS);
  const candles = await fetchRecent(symbols);
  let fired = 0;

  for (const { row, waiting } of users) {
    const hits = waiting
      .map((a) => ({ a, price: alertHitInCandles(a, candles.get(a.symbol) ?? []) }))
      .filter((h): h is { a: PriceAlert; price: number } => h.price !== null);
    if (!hits.length) continue;
    const user = await store.users.get(row.user_id);
    if (!user || user.disabled) continue;
    // Re-read just before writing, so a change saved from the page meanwhile isn't lost.
    const fresh = sanitizeAlerts((await store.markets_state.get(row.id))?.alerts ?? []);
    const now = nowIso();
    const firing = hits.filter((h) => fresh.some((x) => x.id === h.a.id && !x.triggered_at));
    if (!firing.length) continue;
    const next = fresh.map((x) => {
      const h = firing.find((f) => f.a.id === x.id);
      return h ? { ...x, triggered_at: now, triggered_price: h.price } : x;
    });
    await store.markets_state.update(row.id, { alerts: sanitizeAlerts(next), updated_at: now });
    fired += firing.length;

    const lines = firing.map((h) => describeFired(h.a, h.price));
    for (const [i, h] of firing.entries()) {
      await log("alert", `Price alert: ${lines[i]}`, {
        user_id: user.id,
        context: { alert_id: h.a.id, symbol: h.a.symbol, level: h.a.price, reached: h.price },
      });
    }
    const emailed = firing.filter((h) => h.a.email !== false).map((h) => describeFired(h.a, h.price));
    if (emailed.length && emailEnabled() && user.email && user.email_verified_at) {
      try {
        const mail = priceAlertEmail(emailed, `${appUrl()}/dashboard/markets`);
        await sendEmail(user.email, mail.subject, mail.html);
      } catch (error) {
        await log("warn", `Couldn't email a price alert: ${(error as Error).message}`, { user_id: user.id });
      }
    }
  }
  return { waiting: waitingTotal, fired };
}
