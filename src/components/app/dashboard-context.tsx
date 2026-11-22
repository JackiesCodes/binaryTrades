"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "@/lib/client";
import type { DashboardState } from "@/lib/trading/state";
import type { Book } from "@/lib/trading/types";

interface DashboardContextValue {
  state: DashboardState | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Which accounts the overview shows: real-money or demo. */
  view: Book;
  setView: (book: Book) => void;
  lastTick: string | null;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

const STATE_POLL_MS = 5_000;
const TICK_MS = 60_000;

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setViewState] = useState<Book>("real");
  const [lastTick, setLastTick] = useState<string | null>(null);
  const viewChosen = useRef(false);

  const etag = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Send the fingerprint of what's on screen: an unchanged state comes back as an empty 304.
      const res = await fetch("/api/state", { cache: "no-store", headers: etag.current ? { "if-none-match": etag.current } : undefined });
      if (res.status === 304) {
        setError(null);
        return;
      }
      if (!res.ok) {
        await api("/api/state"); // same handling as everywhere else (sign-in again, error message)
        throw new Error(`HTTP ${res.status}`);
      }
      let next: DashboardState;
      try {
        next = JSON.parse(await res.text()) as DashboardState;
      } catch {
        throw new Error("Couldn't read the dashboard data (connection?)");
      }
      // Only a complete answer replaces what's on screen; anything else keeps the last good state.
      if (!isDashboardState(next)) throw new Error("Incomplete dashboard data");
      etag.current = res.headers.get("etag");
      setState(next);
      setError(null);
      // Until you pick, show real accounts — or demo when demo accounts are all you have.
      if (!viewChosen.current) {
        const hasReal = next.brokers.some((b) => !b.is_demo);
        setViewState(hasReal || !next.brokers.length ? "real" : "demo");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const setView = useCallback((book: Book) => {
    viewChosen.current = true;
    setViewState(book);
  }, []);

  useEffect(() => {
    // Only while the page is on screen: a hidden tab or a phone in a pocket doesn't poll
    // (bots keep running through the server's own every-minute job).
    const visible = () => document.visibilityState === "visible";
    void refresh();
    const poll = setInterval(() => visible() && refresh(), STATE_POLL_MS);

    // While the dashboard is open it also drives the bot runner. For 24/7
    // operation point a scheduler at /api/cron/tick (see README).
    const tick = async () => {
      try {
        const report = await api<{ at: string }>("/api/engine/tick", "POST");
        setLastTick(report.at);
        void refresh();
      } catch {
        // Surfaced via logs/broker status instead.
      }
    };
    void tick();
    const tickTimer = setInterval(() => visible() && tick(), TICK_MS);
    // Coming back to the page: catch up straight away.
    const onVisible = () => visible() && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(tickTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <DashboardContext.Provider value={{ state, error, refresh, view, setView, lastTick }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}

function isDashboardState(x: unknown): x is DashboardState {
  const s = x as Partial<DashboardState> | null;
  return Boolean(
    s &&
      typeof s === "object" &&
      s.settings &&
      typeof s.settings === "object" &&
      Array.isArray(s.brokers) &&
      Array.isArray(s.bots) &&
      Array.isArray(s.open_trades) &&
      Array.isArray(s.closed_trades) &&
      Array.isArray(s.logs) &&
      s.kpis &&
      s.meta,
  );
}
