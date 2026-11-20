"use client";

import { useEffect, useMemo, useState } from "react";
import { Flag, Square, Trophy } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { selectClass } from "@/components/app/widgets";
import { AsideTitle, FieldBox, KV } from "@/components/app/workspace";
import { Button } from "@/components/ui/button";
import { api, money } from "@/lib/client";
import type { PublicBroker } from "@/lib/trading/state";
import type { Bot, Challenge } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

/** Same as the engine's CHALLENGE_BUST_FRACTION: a challenge is lost at 10% of the starting equity. */
const BUST = 0.1;
const RISKS = [10, 20, 30, 50];
const TARGETS = [1.5, 2, 3];
const HOURS = [4, 8, 24, 48];

const RESULT: Record<NonNullable<Challenge["result"]>, { label: string; tone: string }> = {
  won: { label: "Reached the target", tone: "text-profit" },
  lost: { label: "Lost 90% of the account", tone: "text-loss" },
  expired: { label: "Ran out of time", tone: "text-gold" },
  stopped: { label: "Stopped", tone: "text-muted-foreground" },
};

/**
 * Out of many challenges with these settings, how many reach the target and how many lose 90%,
 * for a strategy with no edge (wins exactly often enough to break even at 1.4 reward : risk).
 * Assumes about one trade an hour. Deterministic, so the numbers don't flicker.
 */
export function challengeOdds(riskPercent: number, target: number, hours: number, runs = 4000) {
  const rr = 1.4;
  const p = 1 / (1 + rr);
  const trades = Math.min(100, Math.max(3, Math.round(hours)));
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let won = 0;
  let lost = 0;
  for (let r = 0; r < runs; r++) {
    let b = 1;
    for (let t = 0; t < trades; t++) {
      const risk = b * (riskPercent / 100);
      b += rnd() < p ? risk * rr : -risk;
      if (b >= target) {
        won++;
        break;
      }
      if (b <= BUST) {
        lost++;
        break;
      }
    }
  }
  return { won: Math.round((won / runs) * 100), lost: Math.round((lost / runs) * 100), trades };
}

function timeLeft(c: Challenge, now: number) {
  const ms = Date.parse(c.started_at) + c.hours * 3600_000 - now;
  if (ms <= 0) return "ending";
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Demo-only "double the account" challenge for one bot. */
export function ChallengePanel({ bot, broker }: { bot: Bot; broker: PublicBroker }) {
  const { refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [risk, setRisk] = useState(20);
  const [target, setTarget] = useState(2);
  const [hours, setHours] = useState(24);
  const [now, setNow] = useState(() => Date.now());
  const c = bot.challenge ?? null;
  const running = Boolean(c && !c.ended_at);
  const odds = useMemo(() => challengeOdds(risk, target, hours), [risk, target, hours]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [running]);

  const call = async (method: "POST" | "DELETE", body?: unknown, success?: string) => {
    setBusy(true);
    try {
      await api(`/api/bots/${bot.id}/challenge`, method, body);
      await refresh();
      if (success) toast(success, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const ok = await confirm({
      title: `Start a ${risk}% risk challenge?`,
      description: `${bot.name} will risk ${risk}% of ${broker.label} on every trade until the account reaches ${money(broker.equity * target, broker.currency)}, falls to ${money(broker.equity * BUST, broker.currency)}, or ${hours} hours pass. Demo money only. With no edge, about ${odds.won} in 100 challenges like this reach the target and ${odds.lost} lose 90%. Other demo bots may pause if the losses hit your demo Risk Guard limits.`,
      confirmLabel: "Start challenge",
      danger: true,
    });
    if (ok) await call("POST", { risk_percent: risk, target_multiple: target, hours }, "Challenge started");
  };

  const stop = async () => {
    const ok = await confirm({
      title: "Stop the challenge?",
      description: "Closes this bot's open trades and pauses it. The result is recorded as stopped.",
      confirmLabel: "Stop challenge",
      danger: true,
    });
    if (ok) await call("DELETE", undefined, "Challenge stopped");
  };

  if (running && c) {
    const goal = c.start_equity * c.target_multiple;
    const floor = c.start_equity * BUST;
    const eq = broker.equity;
    const change = ((eq - c.start_equity) / c.start_equity) * 100;
    const pos = Math.min(100, Math.max(0, ((eq - floor) / (goal - floor)) * 100));
    const startPos = ((c.start_equity - floor) / (goal - floor)) * 100;
    return (
      <>
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-gold" />
          <AsideTitle>Challenge running</AsideTitle>
          <span className="ml-auto rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">DEMO</span>
        </div>
        <FieldBox>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Equity now</span>
            <span className={cn("font-mono text-xs", change >= 0 ? "text-profit" : "text-loss")}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </div>
          <div className="font-mono text-xl text-ivory">{money(eq, broker.currency)}</div>
          <div className="relative mt-1 h-2 rounded-full bg-white/[0.08]" role="img" aria-label={`Progress ${pos.toFixed(0)}% of the way from the loss limit to the target`}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-loss/70 via-gold/70 to-profit" style={{ width: `${pos}%` }} />
            <span className="absolute -top-1 h-4 w-px bg-ivory/60" style={{ left: `${startPos}%` }} title="Start" />
          </div>
          <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>{money(floor, broker.currency)}</span>
            <span>{money(goal, broker.currency)}</span>
          </div>
        </FieldBox>
        <KV
          rows={[
            ["Started with", money(c.start_equity, broker.currency)],
            ["Target", `×${c.target_multiple} · ${money(goal, broker.currency)}`, "text-profit"],
            ["Risk per trade", `${c.risk_percent}%`, "text-gold"],
            ["Time left", timeLeft(c, now)],
          ]}
        />
        <Button variant="outline" className="w-full border-loss/45 text-loss hover:bg-loss/10 hover:text-loss" disabled={busy} onClick={stop}>
          <Square /> Stop challenge
        </Button>
      </>
    );
  }

  return (
    <>
      {c?.result && (
        <FieldBox>
          <div className="flex items-center gap-2">
            {c.result === "won" ? <Trophy className="h-4 w-4 text-profit" /> : <Flag className="h-4 w-4 text-muted-foreground" />}
            <span className={cn("text-sm font-semibold", RESULT[c.result].tone)}>Last challenge: {RESULT[c.result].label}</span>
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {money(c.start_equity, broker.currency)} → {c.end_equity !== null ? money(c.end_equity, broker.currency) : "—"} · {c.risk_percent}% risk ·{" "}
            {c.ended_at ? new Date(c.ended_at).toLocaleString() : ""}
          </div>
        </FieldBox>
      )}
      <AsideTitle>Double-the-account challenge</AsideTitle>
      <p className="-mt-1 text-xs text-muted-foreground">
        Demo only. The bot risks far more than the normal 5% per trade, and stops at the target, at a 90% loss, or when time runs out.
      </p>
      <FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Risk per trade</span>
            <select className={selectClass} value={risk} onChange={(e) => setRisk(Number(e.target.value))}>
              {RISKS.map((r) => (
                <option key={r} value={r}>
                  {r}% of the account
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Target</span>
            <select className={selectClass} value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              {TARGETS.map((t) => (
                <option key={t} value={t}>
                  ×{t}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Time limit</span>
            <select className={selectClass} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>
          </label>
        </div>
      </FieldBox>
      <div className="rounded-[14px] bg-black/25 p-3">
        <div className="text-xs font-semibold text-ivory">Out of 100 challenges like this</div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="font-mono text-lg text-profit">{odds.won}</div>
            <div className="text-[11px] text-muted-foreground">reach ×{target}</div>
          </div>
          <div>
            <div className="font-mono text-lg text-loss">{odds.lost}</div>
            <div className="text-[11px] text-muted-foreground">lose 90%</div>
          </div>
          <div>
            <div className="font-mono text-lg text-ivory">{100 - odds.won - odds.lost}</div>
            <div className="text-[11px] text-muted-foreground">time runs out</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Simulated for a strategy with no edge (what our backtests found so far), 1.4 reward : risk, about one trade an hour.
          &ldquo;Time runs out&rdquo; endings can be up or down; over 24 hours or more, most are down.
        </p>
      </div>
      <Button className="h-12 w-full bg-gold text-[15px] font-bold text-ink hover:bg-gold/90" disabled={busy || !(broker.equity > 0)} onClick={start}>
        <Flag /> Start challenge on {money(broker.equity, broker.currency)}
      </Button>
    </>
  );
}
