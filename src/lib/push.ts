import "server-only";

import { createECDH, hkdfSync } from "node:crypto";
import webpush from "web-push";

import { appUrl } from "@/lib/auth/email";
import { getStore, nowIso, type Store } from "@/lib/trading/store";
import type { EventLog, PushDevice, PushTopics } from "@/lib/trading/types";

/**
 * Web Push: notifications on phones and computers even when binaryTrades isn't open.
 *
 * Signing keys (VAPID): VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set (`npx web-push generate-vapid-keys`),
 * otherwise derived from SESSION_SECRET, so there's no extra secret to manage. Changing SESSION_SECRET
 * changes the keys: devices then need notifications turned on again (the Account page re-subscribes).
 */

export const MAX_DEVICES_PER_USER = 10;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const derived = new Map<string, VapidKeys>();

/** The site's push signing keys, or null when neither VAPID keys nor SESSION_SECRET are set. */
export function vapidKeys(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const pub = env.VAPID_PUBLIC_KEY?.trim();
  const priv = env.VAPID_PRIVATE_KEY?.trim();
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  const cached = derived.get(secret);
  if (cached) return cached;
  // A P-256 private key from the secret (HKDF, own label so it's independent of session signing).
  const key = Buffer.from(hkdfSync("sha256", secret, "binarytrades", "web-push vapid v1", 32));
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(key); // throws for the (astronomically unlikely) out-of-range value
  const keys = { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: key.toString("base64url") };
  derived.set(secret, keys);
  return keys;
}

export function pushPublicKey(): string | null {
  return vapidKeys()?.publicKey ?? null;
}

export function pushEnabled(): boolean {
  return vapidKeys() !== null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped (a path on this site). */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag?: string;
}

/** Which log lines become notifications, and how they read. Null = not a notification. */
export function messageForLog(level: EventLog["level"], message: string, botName?: string | null): { topic: keyof PushTopics; msg: PushMessage } | null {
  if (level === "alert") {
    return {
      topic: "alerts",
      msg: { title: "Price alert", body: message.replace(/^Price alert:\s*/, ""), url: "/dashboard/markets", tag: `alert-${message.slice(0, 60)}` },
    };
  }
  if (level === "trade") {
    // Opens: "DERIV BUY …", closes: "DERIV close …", "MT5 closed …". Queued MT5 orders aren't trades yet.
    if (/queued/i.test(message)) return null;
    const closed = /\bclose(d)?\b/i.test(message);
    const who = botName ? `${botName}: ` : "";
    return {
      topic: "trades",
      msg: { title: closed ? "Trade closed" : "Trade opened", body: `${who}${message}`, url: "/dashboard/trades" },
    };
  }
  return null;
}

let configuredWith: string | null = null;
function configure() {
  const keys = vapidKeys()!;
  if (configuredWith === keys.publicKey) return;
  // The subject tells push services who to contact about misuse: the site's own address.
  webpush.setVapidDetails(appUrl(), keys.publicKey, keys.privateKey);
  configuredWith = keys.publicKey;
}

export type PushSender = (device: PushDevice, payload: string) => Promise<void>;

const webPushSender: PushSender = async (device, payload) => {
  configure();
  await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, {
    TTL: 60 * 60, // an hour: a stale trade notice is worse than none
    timeout: 5_000,
    urgency: "high",
  });
};

/** Push gone for good (unsubscribed, app removed): forget the device. */
function isGone(error: unknown): boolean {
  const code = (error as { statusCode?: number }).statusCode;
  return code === 404 || code === 410;
}

/**
 * Send to the user's devices that want this topic (all of them when topic is null, e.g. a test).
 * Never throws: a failed notification must not break trading. Returns how many devices got it.
 */
export async function sendPush(
  userId: string,
  topic: keyof PushTopics | null,
  msg: PushMessage,
  opts: { store?: Store; send?: PushSender; only?: string } = {},
): Promise<number> {
  const send = opts.send ?? (pushEnabled() ? webPushSender : null);
  if (!send) return 0;
  const store = opts.store ?? getStore();
  let devices: PushDevice[];
  try {
    devices = await store.push_devices.all({ eq: { user_id: userId } });
  } catch {
    return 0; // table not there yet, database hiccup: skip quietly
  }
  devices = devices.filter((d) => (opts.only ? d.id === opts.only : true) && (topic === null || d.topics?.[topic] !== false));
  const payload = JSON.stringify({ ...msg, url: msg.url.startsWith("/") ? msg.url : "/dashboard" });
  let sent = 0;
  await Promise.all(
    devices.map(async (d) => {
      try {
        await send(d, payload);
        sent++;
        await store.push_devices.update(d.id, { last_sent_at: nowIso() }).catch(() => {});
      } catch (error) {
        if (isGone(error)) await store.push_devices.remove(d.id).catch(() => {});
        else console.warn(`[push] ${d.id}: ${(error as Error).message}`);
      }
    }),
  );
  return sent;
}

/** Called for every log line: alerts and trades become notifications on the user's devices. */
export async function pushForLog(
  level: EventLog["level"],
  message: string,
  userId: string | null,
  botId: string | null | undefined,
  store: Store,
): Promise<void> {
  if (!userId || (level !== "alert" && level !== "trade")) return;
  if (!pushEnabled()) return;
  let botName: string | null = null;
  if (botId) botName = (await store.bots.get(botId).catch(() => null))?.name ?? null;
  const n = messageForLog(level, message, botName);
  if (n) await sendPush(userId, n.topic, n.msg, { store });
}
