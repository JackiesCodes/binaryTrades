"use client";

import { useState } from "react";
import { Octagon } from "lucide-react";

import { useDashboard } from "@/components/app/dashboard-context";
import { useFeedback } from "@/components/app/feedback";
import { Panel } from "@/components/app/widgets";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

/** The emergency stop: pauses every bot and closes every open position. */
export function useKillSwitch() {
  const { state, refresh } = useDashboard();
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const on = state?.settings.kill_switch ?? false;

  const toggle = async () => {
    const ok = await confirm(
      on
        ? {
            title: "Release the kill switch?",
            description: "Bots stay paused until you start each one again.",
            confirmLabel: "Release",
          }
        : {
            title: "Activate kill switch?",
            description:
              "Every bot pauses and every open position closes — including positions from other EAs on your MT5 accounts.",
            confirmLabel: "Stop everything",
            danger: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/kill-switch", "POST", { on: !on });
      await refresh();
      toast(on ? "Kill switch released" : "Kill switch active — all bots paused", on ? "success" : "error");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return { on, busy, toggle, ready: Boolean(state) };
}

/** Compact button for page headers (Bots). */
export function KillSwitchButton({ className, variantOff = "destructive" }: { className?: string; variantOff?: "destructive" | "ghost" }) {
  const kill = useKillSwitch();
  return (
    <Button
      variant={kill.on ? "outline" : variantOff === "ghost" ? "outline" : "destructive"}
      onClick={kill.toggle}
      disabled={kill.busy || !kill.ready}
      className={cn(!kill.on && variantOff === "ghost" && "border-loss/45 text-loss hover:bg-loss/10 hover:text-loss", className)}
    >
      <Octagon /> {kill.on ? "Release kill switch" : "Stop all bots"}
    </Button>
  );
}

/** Full panel with an explanation (Risk Guard). */
export function KillSwitchPanel() {
  const { state } = useDashboard();
  const kill = useKillSwitch();
  const running = state?.bots.filter((b) => b.status === "running").length ?? 0;
  const open = state?.open_trades.length ?? 0;
  return (
    <Panel className={cn(kill.on ? "border-loss/40 bg-loss/[0.06]" : undefined)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ivory">
            <Octagon className={cn("h-4 w-4", kill.on ? "text-loss" : "text-muted-foreground")} />
            Kill switch {kill.on ? <span className="text-loss">· ON</span> : <span className="text-muted-foreground">· off</span>}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {kill.on
              ? "No new trades will be placed. Releasing it does not restart bots — start each one again from Bots."
              : `Emergency stop: pauses all ${running} running bot${running === 1 ? "" : "s"} and closes ${open} open position${open === 1 ? "" : "s"} on every account, including other EAs on your MT5 accounts.`}
          </p>
        </div>
        <Button
          variant={kill.on ? "outline" : "destructive"}
          onClick={kill.toggle}
          disabled={kill.busy || !kill.ready}
          className="w-full sm:w-auto"
        >
          <Octagon /> {kill.on ? "Release kill switch" : "Stop everything"}
        </Button>
      </div>
    </Panel>
  );
}
