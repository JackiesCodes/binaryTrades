"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MARKETS_KEYS, sanitizePart, type MarketsDoc, type MarketsKey } from "@/lib/markets/state";

/** Where the Markets page is saved right now. */
export type SyncStatus = "loading" | "saving" | "synced" | "local";

// Browser copies (also used before stage 4, so existing data carries over).
const LOCAL_KEYS: Record<MarketsKey, string> = {
  watchlist: "bt.markets.watchlist.v1",
  indicators: "bt.markets.indicators.v1",
  drawings: "bt.markets.drawings.v1",
  alerts: "bt.markets.alerts.v1",
};
const SAVE_DELAY = 700;
const RETRY_DELAY = 30_000;

function readLocal(key: MarketsKey): unknown {
  try {
    const raw = localStorage.getItem(LOCAL_KEYS[key]);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}
function writeLocal(key: MarketsKey, value: unknown) {
  try {
    localStorage.setItem(LOCAL_KEYS[key], JSON.stringify(value));
  } catch {
    // full or blocked: the account copy still has it
  }
}

async function request(method: "GET" | "PUT", body?: unknown, keepalive = false): Promise<Record<string, unknown>> {
  const res = await fetch("/api/markets/state", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    keepalive,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { details?: unknown };
    throw new SaveError(res.status, typeof data.details === "string" ? data.details : `HTTP ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** The server refused a save (HTTP 4xx): retrying the same data won't help. */
class SaveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The user's watchlist, indicators, drawings and alerts: shown at once from this browser's copy,
 * then replaced by what's saved in the account (other devices). Changes save to the account after
 * a short pause and to this browser straight away; if the account can't be reached they stay in
 * this browser and are sent once it can. Browser data from before accounts saved it is uploaded once.
 */
export function useMarketsState() {
  const [doc, setDoc] = useState<MarketsDoc | null>(null);
  const [status, setStatus] = useState<SyncStatus>("loading");
  /** Why the server refused the last save, until it's shown. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const docRef = useRef<MarketsDoc | null>(null);
  const dirty = useRef(new Set<MarketsKey>());
  const loaded = useRef(false); // the account copy has been read
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void sync(), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Read the account copy (once), then send whatever changed here. */
  const sync = useCallback(async () => {
    timer.current = null;
    try {
      if (!loaded.current) {
        const server = await request("GET");
        loaded.current = true;
        const next = { ...docRef.current! };
        for (const key of MARKETS_KEYS) {
          // Changes made here while the account was out of reach win; otherwise the account does.
          if (server[key] === null || server[key] === undefined) {
            if (readLocal(key) !== undefined) dirty.current.add(key); // upload this browser's data once
          } else if (!dirty.current.has(key)) {
            (next as Record<string, unknown>)[key] = sanitizePart(key, server[key]);
            writeLocal(key, next[key]);
          }
        }
        docRef.current = next;
        setDoc(next);
      }
      if (dirty.current.size) {
        const keys = [...dirty.current];
        dirty.current.clear();
        setStatus("saving");
        try {
          await request("PUT", Object.fromEntries(keys.map((k) => [k, docRef.current![k]])));
        } catch (e) {
          if (e instanceof SaveError && e.status >= 400 && e.status < 500 && e.status !== 401) {
            // Refused (e.g. an alert trade on a real-account bot): drop that change, show why,
            // and go back to what the account has.
            setRefusal(e.message);
            loaded.current = false;
            schedule(0);
            return;
          }
          keys.forEach((k) => dirty.current.add(k));
          throw e;
        }
      }
      setStatus("synced");
    } catch {
      setStatus("local");
      schedule(RETRY_DELAY);
    }
  }, [schedule]);

  useEffect(() => {
    const local: MarketsDoc = {
      watchlist: sanitizePart("watchlist", readLocal("watchlist")),
      indicators: sanitizePart("indicators", readLocal("indicators") ?? []),
      drawings: sanitizePart("drawings", readLocal("drawings") ?? {}),
      alerts: sanitizePart("alerts", readLocal("alerts") ?? []),
    };
    docRef.current = local;
    setDoc(local);
    void sync();
    // Send unsaved changes when the page is closed or hidden.
    const flush = () => {
      if (!loaded.current || !dirty.current.size || !docRef.current) return;
      const body = Object.fromEntries([...dirty.current].map((k) => [k, docRef.current![k]]));
      dirty.current.clear();
      request("PUT", body, true).catch(() => undefined);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    // Alerts can also fire on the server (every minute, even with the site closed): pick those up.
    const refresh = setInterval(async () => {
      if (!loaded.current || dirty.current.has("alerts") || document.visibilityState !== "visible") return;
      try {
        const server = await request("GET");
        if (server.alerts === null || server.alerts === undefined || dirty.current.has("alerts") || !docRef.current) return;
        const alerts = sanitizePart("alerts", server.alerts);
        if (JSON.stringify(alerts) === JSON.stringify(docRef.current.alerts)) return;
        docRef.current = { ...docRef.current, alerts };
        setDoc(docRef.current);
        writeLocal("alerts", alerts);
      } catch {
        // try again next minute
      }
    }, 60_000);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      flush();
      clearInterval(refresh);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [sync]);

  /** Change one part (a value, or a function of the current value). */
  const update = useCallback(
    <K extends MarketsKey>(key: K, value: MarketsDoc[K] | ((prev: MarketsDoc[K]) => MarketsDoc[K])) => {
      if (!docRef.current) return;
      const prev = docRef.current[key];
      const next = typeof value === "function" ? (value as (p: MarketsDoc[K]) => MarketsDoc[K])(prev) : value;
      if (next === prev) return;
      docRef.current = { ...docRef.current, [key]: next };
      setDoc(docRef.current);
      writeLocal(key, next);
      dirty.current.add(key);
      if (loaded.current) schedule(SAVE_DELAY);
    },
    [schedule],
  );

  const clearRefusal = useCallback(() => setRefusal(null), []);
  return { doc, status, update, refusal, clearRefusal };
}
