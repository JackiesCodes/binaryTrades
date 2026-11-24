import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

// Capture what would go to the push services instead of sending it.
const pushed: Array<{ endpoint: string; payload: Record<string, string> }> = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  },
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/push/route";
import { POST as TEST } from "@/app/api/push/test/route";
import { createSessionToken } from "@/lib/auth/session";
import { createUser } from "@/lib/auth/users";
import { messageForLog, sendPush, vapidKeys } from "@/lib/push";
import { deviceLabel, isPushEndpoint } from "@/lib/push-endpoint";
import { getStore, log, nowIso, resetStore } from "@/lib/trading/store";

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

beforeEach(() => {
  process.env.DATA_FILE = join(mkdtempSync(join(tmpdir(), "bt-push-")), "store.json");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SESSION_SECRET = "test-session-secret-0123456789";
  process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests";
  process.env.VAPID_PRIVATE_KEY = "private-key-for-tests";
  resetStore();
  cookie = undefined;
  pushed.length = 0;
  failWith = null;
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

async function signIn(email: string) {
  const u = await createUser({ email, password: "a long password" });
  cookie = (await createSessionToken(u.id, u.session_version)).value;
  return u;
}
const req = (method: string, body?: unknown, ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36") =>
  new Request("http://localhost/api/push", {
    method,
    headers: { "content-type": "application/json", "user-agent": ua },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = { params: {} };

describe("push endpoints", () => {
  it("only accepts the real push services over https", () => {
    expect(isPushEndpoint(FCM)).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QX")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://evilfcm.googleapis.com.example/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });

  it("names devices from the browser", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBeNull();
  });
});

describe("which events notify", () => {
  it("price alerts and opened/closed trades, not queued MT5 orders or other logs", () => {
    expect(messageForLog("alert", "Price alert: Gold above 3,750")).toMatchObject({ topic: "alerts", msg: { title: "Price alert", body: "Gold above 3,750" } });
    expect(messageForLog("trade", "DERIV BUY frxXAUUSD stake 10 ×100", "Gold bot")).toMatchObject({
      topic: "trades",
      msg: { title: "Trade opened", body: "Gold bot: DERIV BUY frxXAUUSD stake 10 ×100" },
    });
    expect(messageForLog("trade", "DERIV closed frxXAUUSD +3.20")?.msg.title).toBe("Trade closed");
    expect(messageForLog("trade", "MT5 closed EURUSD -1.00")?.msg.title).toBe("Trade closed");
    expect(messageForLog("trade", "MT5 BUY EURUSD queued for Exness")).toBeNull();
    expect(messageForLog("info", "Bot started")).toBeNull();
  });

  it("problems: errors, paused bots, the kill switch and security changes, not routine warnings", () => {
    expect(messageForLog("error", "Gold bot paused: Script error — x is not defined")).toMatchObject({
      topic: "problems",
      msg: { title: "Needs your attention", url: "/dashboard/logs" },
    });
    expect(messageForLog("error", "KILL SWITCH: daily loss limit hit. All bots paused, all positions closing.")).toMatchObject({
      topic: "problems",
      msg: { title: "Kill switch on", body: "daily loss limit hit. All bots paused, all positions closing.", url: "/dashboard/risk" },
    });
    expect(messageForLog("warn", "Max drawdown reached — paused 2 real-account bot(s) until you restart them")?.topic).toBe("problems");
    expect(messageForLog("warn", "MT5 open command was not confirmed by the bridge within 3 minutes")?.topic).toBe("problems");
    expect(messageForLog("warn", "Password changed — other devices were signed out")).toMatchObject({ msg: { title: "Account security", url: "/dashboard/account" } });
    expect(messageForLog("warn", "Signed out all other devices")?.msg.title).toBe("Account security");
    expect(messageForLog("warn", "Gold bot: buy signal rejected — max open trades reached")).toBeNull();
    expect(messageForLog("warn", "Couldn't email a price alert: timeout")).toBeNull();
  });
});

describe("/api/push", () => {
  it("subscribes a device, lists it, changes topics and removes it", async () => {
    await signIn("ann@example.com");
    const res = await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx);
    expect(res.status).toBe(200);
    const { device } = await res.json();
    expect(device).toMatchObject({ label: "Chrome on Android", topics: { alerts: true, trades: true } });
    expect(device.endpoint).toBeUndefined(); // the push address stays on the server

    const list = await (await GET(req("GET"), ctx)).json();
    expect(list).toMatchObject({ enabled: true, public_key: "BPublicKeyForTests" });
    expect(list.devices).toHaveLength(1);

    // Subscribing again (page reload) updates the same device and keeps the chosen topics.
    await PATCH(req("PATCH", { id: device.id, topics: { alerts: true, trades: false } }), ctx);
    await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx);
    const again = await getStore().push_devices.all();
    expect(again).toHaveLength(1);
    expect(again[0]!.topics).toEqual({ alerts: true, trades: false });

    expect((await DELETE(req("DELETE", { id: device.id }), ctx)).status).toBe(204);
    expect(await getStore().push_devices.all()).toHaveLength(0);
  });

  it("remembers the device's time zone for the evening summary", async () => {
    await signIn("ann@example.com");
    expect((await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS }, timezone: "Mars/Olympus" }), ctx)).status).toBe(400);
    await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS }, timezone: "Africa/Johannesburg" }), ctx);
    await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx); // older page: keeps the zone
    expect((await getStore().push_devices.all())[0]!.timezone).toBe("Africa/Johannesburg");
  });

  it("refuses non-push addresses, other users' devices and signed-out calls", async () => {
    expect((await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx)).status).toBe(401);
    await signIn("ann@example.com");
    expect((await POST(req("POST", { subscription: { endpoint: "https://example.com/hook", keys: KEYS } }), ctx)).status).toBe(400);
    const { device } = await (await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx)).json();

    await signIn("bob@example.com");
    expect((await PATCH(req("PATCH", { id: device.id, topics: { alerts: false, trades: false } }), ctx)).status).toBe(404);
    await DELETE(req("DELETE", { id: device.id }), ctx);
    expect(await getStore().push_devices.all()).toHaveLength(1); // still Ann's
    expect((await (await GET(req("GET"), ctx)).json()).devices).toEqual([]);
  });

  it("derives signing keys from SESSION_SECRET when no VAPID keys are set", async () => {
    const a = vapidKeys({ SESSION_SECRET: "test-session-secret-0123456789" })!;
    expect(Buffer.from(a.publicKey, "base64url")).toHaveLength(65); // uncompressed P-256 point
    expect(Buffer.from(a.privateKey, "base64url")).toHaveLength(32);
    expect(vapidKeys({ SESSION_SECRET: "test-session-secret-0123456789" })).toEqual(a); // stable
    expect(vapidKeys({ SESSION_SECRET: "another-secret-0123456789" })!.publicKey).not.toBe(a.publicKey);
    expect(vapidKeys({ VAPID_PUBLIC_KEY: "P", VAPID_PRIVATE_KEY: "K", SESSION_SECRET: "x".repeat(20) })).toEqual({ publicKey: "P", privateKey: "K" });
    expect(vapidKeys({})).toBeNull();

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    await signIn("ann@example.com");
    expect((await (await GET(req("GET"), ctx)).json()).public_key).toBe(vapidKeys()!.publicKey);
  });

  it("sends a test notification to the chosen device only", async () => {
    await signIn("ann@example.com");
    const { device } = await (await POST(req("POST", { subscription: { endpoint: FCM, keys: KEYS } }), ctx)).json();
    await POST(req("POST", { subscription: { endpoint: `${FCM}-laptop`, keys: KEYS } }), ctx);
    const res = await TEST(req("POST", { id: device.id }), ctx);
    expect(res.status).toBe(200);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ endpoint: FCM, payload: { title: "binaryTrades", url: "/dashboard" } });
  });
});

describe("notifications from the engine's log", () => {
  async function device(userId: string, endpoint: string, topics = { alerts: true, trades: true }) {
    await getStore().push_devices.insert({ id: endpoint.slice(-8), user_id: userId, endpoint, ...KEYS, topics, label: null, created_at: nowIso(), last_sent_at: null });
  }

  it("a trade log notifies the owner's devices that want trades", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    const bob = await createUser({ email: "bob@example.com", password: "a long password" });
    await device(ann.id, `${FCM}/phone001`);
    await device(ann.id, `${FCM}/laptop01`, { alerts: true, trades: false });
    await device(bob.id, `${FCM}/bobphone`);

    await log("trade", "DERIV closed frxXAUUSD +3.20", { user_id: ann.id });
    expect(pushed.map((p) => p.endpoint)).toEqual([`${FCM}/phone001`]);
    expect(pushed[0]!.payload).toMatchObject({ title: "Trade closed", body: "DERIV closed frxXAUUSD +3.20", url: "/dashboard/trades" });
    expect((await getStore().push_devices.get("phone001"))!.last_sent_at).not.toBeNull();

    pushed.length = 0;
    await log("alert", "Price alert: Gold above 3,750", { user_id: ann.id });
    expect(pushed.map((p) => p.endpoint).sort()).toEqual([`${FCM}/laptop01`, `${FCM}/phone001`]);

    pushed.length = 0;
    await log("info", "Bot started", { user_id: ann.id });
    expect(pushed).toHaveLength(0);
  });

  it("the same problem notifies once per half hour, and only devices that want problems", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await device(ann.id, `${FCM}/phone001`);
    await device(ann.id, `${FCM}/laptop01`, { alerts: true, trades: true, problems: false } as never);
    await log("error", "Engine error: Deriv timeout", { user_id: ann.id });
    await log("error", "Engine error: Deriv timeout", { user_id: ann.id }); // next minute, same thing
    expect(pushed.map((p) => p.endpoint)).toEqual([`${FCM}/phone001`]);
    expect(pushed[0]!.payload).toMatchObject({ title: "Needs your attention", body: "Engine error: Deriv timeout" });
    await log("error", "Engine error: something else", { user_id: ann.id });
    expect(pushed).toHaveLength(2);
    await log("warn", "Gold bot: sell signal rejected — Risk Guard", { user_id: ann.id });
    expect(pushed).toHaveLength(2);
  });

  it("forgets devices the push service says are gone, and never throws", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await device(ann.id, `${FCM}/phone001`);
    failWith = 500;
    await expect(log("trade", "DERIV BUY frxXAUUSD", { user_id: ann.id })).resolves.toBeUndefined();
    expect(await getStore().push_devices.all()).toHaveLength(1); // a hiccup keeps it
    failWith = 410;
    expect(await sendPush(ann.id, "trades", { title: "t", body: "b", url: "/dashboard" })).toBe(0);
    expect(await getStore().push_devices.all()).toHaveLength(0);
  });

  it("does nothing when push isn't configured", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.SESSION_SECRET;
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    await device(ann.id, `${FCM}/phone001`);
    await log("trade", "DERIV BUY frxXAUUSD", { user_id: ann.id });
    expect(pushed).toHaveLength(0);
  });
});

describe("a broken notification never breaks trading", () => {
  it("log() still resolves when the push code throws", async () => {
    const ann = await createUser({ email: "ann@example.com", password: "a long password" });
    const spy = vi.spyOn(getStore().push_devices, "all").mockImplementation(() => {
      throw new Error("boom"); // synchronous throw, past the usual async error handling
    });
    await expect(log("trade", "DERIV BUY frxXAUUSD", { user_id: ann.id })).resolves.toBeUndefined();
    expect((await getStore().logs.all()).some((l) => l.message === "DERIV BUY frxXAUUSD")).toBe(true);
    spy.mockRestore();
  });
});
