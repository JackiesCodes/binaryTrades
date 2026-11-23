"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Smartphone, Trash2 } from "lucide-react";

import { useFeedback } from "@/components/app/feedback";
import { Panel } from "@/components/app/widgets";
import { Button } from "@/components/ui/button";
import { api, timeAgo } from "@/lib/client";
import type { PushTopics } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

interface DeviceView {
  id: string;
  label: string | null;
  topics: PushTopics;
  created_at: string;
  last_sent_at: string | null;
}

interface PushInfo {
  enabled: boolean;
  public_key: string | null;
  devices: DeviceView[];
}

type Support = "checking" | "yes" | "no" | "ios-browser";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectSupport(): Support {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  // iPhones only allow notifications for sites added to the Home Screen.
  if (ios && !standalone) return "ios-browser";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "yes" : "no";
}

/** The browser's push service can hang (no network, blocked); don't leave the button spinning. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error("The push service didn't answer"), { name: "AbortError" })), ms)),
  ]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

const TOPICS: Array<{ key: keyof PushTopics; label: string; about: string }> = [
  { key: "alerts", label: "Price alerts", about: "When a price alert on the Markets page is reached" },
  { key: "trades", label: "Trades", about: "When a bot opens or closes a trade" },
  { key: "problems", label: "Problems", about: "A bot paused or failing, a refused order, the kill switch, or a security change on your account" },
];

/** Turn push notifications on for this phone or computer, choose what they're about, manage devices. */
export function NotificationsPanel() {
  const { confirm, toast } = useFeedback();
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [thisId, setThisId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = detectSupport();
    setSupport(s);
    const data = await api<PushInfo>("/api/push");
    if (s === "yes") {
      setPermission(Notification.permission);
      // Already subscribed in this browser: refresh it on the server and learn which device it is.
      const sub = data.enabled ? await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription() : null;
      if (sub) {
        try {
          const res = await api<{ device: DeviceView }>("/api/push", "POST", { subscription: sub.toJSON() });
          setThisId(res.device.id);
          data.devices = [res.device, ...data.devices.filter((d) => d.id !== res.device.id)];
        } catch {
          setThisId(null);
        }
      }
    }
    setInfo(data);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => toast(e.message, "error"));
  }, [load, toast]);

  const turnOn = async () => {
    if (!info?.public_key) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast("Notifications weren't allowed. You can allow them in your browser's site settings.", "error", 8000);
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.public_key) }), 20_000));
      const res = await api<{ device: DeviceView }>("/api/push", "POST", { subscription: sub.toJSON() });
      setThisId(res.device.id);
      setInfo({ ...info, devices: [res.device, ...info.devices.filter((d) => d.id !== res.device.id)] });
      await api("/api/push/test", "POST", { id: res.device.id }).catch(() => undefined);
      toast("Notifications are on for this device", "success");
    } catch (e) {
      const err = e as Error;
      // The browser refused to subscribe (private window, push service unreachable, blocked by a setting).
      const browserRefused = err.name === "NotAllowedError" || err.name === "AbortError" || /registration failed|push service/i.test(err.message);
      toast(
        browserRefused
          ? "This browser couldn't turn on notifications. Private or incognito windows can't receive them; try a normal window."
          : err.message,
        "error",
        10_000,
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: DeviceView) => {
    const here = d.id === thisId;
    const ok = await confirm({
      title: here ? "Turn off notifications here?" : `Stop notifications on ${d.label ?? "that device"}?`,
      description: "Price alerts and trades will no longer notify it. Emails and Alerts & Logs carry on.",
      confirmLabel: "Turn off",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api("/api/push", "DELETE", { id: d.id });
      if (here) {
        const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        await sub?.unsubscribe().catch(() => undefined);
        setThisId(null);
      }
      setInfo((i) => (i ? { ...i, devices: i.devices.filter((x) => x.id !== d.id) } : i));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const setTopic = async (d: DeviceView, key: keyof PushTopics, on: boolean) => {
    const topics = { ...d.topics, [key]: on };
    setInfo((i) => (i ? { ...i, devices: i.devices.map((x) => (x.id === d.id ? { ...x, topics } : x)) } : i));
    try {
      await api("/api/push", "PATCH", { id: d.id, topics });
    } catch (e) {
      toast((e as Error).message, "error");
      setInfo((i) => (i ? { ...i, devices: i.devices.map((x) => (x.id === d.id ? d : x)) } : i));
    }
  };

  const test = async (d: DeviceView) => {
    try {
      await api("/api/push/test", "POST", { id: d.id });
      toast("Test notification sent", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const here = info?.devices.find((d) => d.id === thisId) ?? null;
  const others = info?.devices.filter((d) => d.id !== thisId) ?? [];

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <BellRing className="h-4 w-4" /> Notifications
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Get a notification on this phone or computer when a price alert is reached, a bot opens or closes a trade, or something needs your
        attention, even when binaryTrades isn&apos;t open.
      </p>

      {!info || support === "checking" ? (
        <div className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />
      ) : !info.enabled ? (
        <p className="rounded-xl bg-black/25 p-3 text-sm text-muted-foreground">Notifications aren&apos;t set up on this site yet.</p>
      ) : support === "ios-browser" ? (
        <p className="rounded-xl bg-black/25 p-3 text-sm text-muted-foreground">
          On iPhone and iPad, add binaryTrades to your Home Screen first: tap <b className="text-ivory">Share</b>, then{" "}
          <b className="text-ivory">Add to Home Screen</b>. Open it from there and come back to this page.
        </p>
      ) : support === "no" ? (
        <p className="rounded-xl bg-black/25 p-3 text-sm text-muted-foreground">This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari.</p>
      ) : permission === "denied" && !here ? (
        <p className="rounded-xl bg-black/25 p-3 text-sm text-muted-foreground">
          Notifications are blocked for binaryTrades in this browser. Allow them in the site settings (the icon next to the address), then
          reload this page.
        </p>
      ) : here ? (
        <DeviceRow d={here} thisDevice busy={busy} onTopic={setTopic} onTest={test} onRemove={remove} />
      ) : (
        <Button onClick={turnOn} disabled={busy} className="h-11 w-full rounded-xl sm:w-auto">
          <BellRing /> {busy ? "Turning on…" : "Turn on notifications here"}
        </Button>
      )}

      {info?.enabled && others.length > 0 && (
        <div className="mt-4 grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other devices</h3>
          {others.map((d) => (
            <DeviceRow key={d.id} d={d} busy={busy} onTopic={setTopic} onTest={test} onRemove={remove} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function DeviceRow({
  d,
  thisDevice,
  busy,
  onTopic,
  onTest,
  onRemove,
}: {
  d: DeviceView;
  thisDevice?: boolean;
  busy: boolean;
  onTopic: (d: DeviceView, key: keyof PushTopics, on: boolean) => void;
  onTest: (d: DeviceView) => void;
  onRemove: (d: DeviceView) => void;
}) {
  return (
    <div className="rounded-xl bg-black/25 p-3">
      <div className="flex items-center gap-2.5">
        <Smartphone className="h-4 w-4 shrink-0 text-profit" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ivory">
            {d.label ?? "Browser"}
            {thisDevice && <span className="ml-1.5 text-xs font-normal text-profit">· this device</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            On since {new Date(d.created_at).toLocaleDateString()}
            {d.last_sent_at ? ` · last notified ${timeAgo(d.last_sent_at)}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(d)}
          disabled={busy}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-loss/10 hover:text-loss disabled:opacity-40 lg:h-8 lg:w-8"
          aria-label={thisDevice ? "Turn off notifications here" : `Stop notifications on ${d.label ?? "this device"}`}
          title="Turn off"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2.5 grid gap-1.5">
        {TOPICS.map((t) => {
          const on = d.topics?.[t.key] !== false;
          return (
            <label key={t.key} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={on}
                onChange={(e) => onTopic(d, t.key, e.target.checked)}
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
                <span className="block text-sm text-ivory">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.about}</span>
              </span>
            </label>
          );
        })}
      </div>
      {thisDevice && (
        <Button variant="outline" onClick={() => onTest(d)} className="mt-2.5 h-10 w-full rounded-xl sm:w-auto">
          Send a test notification
        </Button>
      )}
    </div>
  );
}
