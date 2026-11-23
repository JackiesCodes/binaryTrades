import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { MAX_DEVICES_PER_USER, pushEnabled, pushPublicKey } from "@/lib/push";
import { deviceLabel, isPushEndpoint } from "@/lib/push-endpoint";
import { getStore, nowIso } from "@/lib/trading/store";
import type { PushDevice } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

const deviceId = (endpoint: string) => createHash("sha256").update(endpoint).digest("base64url").slice(0, 32);

const view = (d: PushDevice) => ({ id: d.id, label: d.label, topics: d.topics, created_at: d.created_at, last_sent_at: d.last_sent_at });

/** Whether push is set up on the server, its public key, and the user's devices. */
export const GET = withUser(async (user) => {
  const devices = pushEnabled() ? await getStore().push_devices.all({ eq: { user_id: user.id } }).catch(() => []) : [];
  return NextResponse.json({ enabled: pushEnabled(), public_key: pushPublicKey(), devices: devices.map(view) });
});

const topics = z.object({ alerts: z.boolean(), trades: z.boolean() }).strict();
const subscribeSchema = z
  .object({
    subscription: z.object({
      endpoint: z.string().max(1000).refine(isPushEndpoint, "Not a push service address"),
      keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
    }),
    topics: topics.optional(),
  })
  .strict();

/** Turn notifications on for this browser (or update its keys / topics). */
export const POST = withUser(async (user, request) => {
  if (!pushEnabled()) return jsonError(503, "PUSH_NOT_CONFIGURED");
  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const { subscription, topics: chosen } = parsed.data;
  const store = getStore().push_devices;
  const id = deviceId(subscription.endpoint);
  const existing = await store.get(id);
  const row: PushDevice = {
    id,
    user_id: user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    topics: chosen ?? (existing?.user_id === user.id ? existing.topics : { alerts: true, trades: true }),
    label: deviceLabel(request.headers.get("user-agent")),
    created_at: existing?.user_id === user.id ? existing.created_at : nowIso(),
    last_sent_at: null,
  };
  // The same browser signed in to another account: it now belongs to this one.
  if (existing) await store.remove(id);
  else if ((await store.all({ eq: { user_id: user.id } })).length >= MAX_DEVICES_PER_USER) return jsonError(409, "TOO_MANY_DEVICES");
  return NextResponse.json({ device: view(await store.insert(row)) });
});

const patchSchema = z.object({ id: z.string().min(1).max(64), topics }).strict();

/** Choose what a device is notified about. */
export const PATCH = withUser(async (user, request) => {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const store = getStore().push_devices;
  const d = await store.get(parsed.data.id);
  if (!d || d.user_id !== user.id) return jsonError(404, "NOT_FOUND");
  return NextResponse.json({ device: view((await store.update(d.id, { topics: parsed.data.topics }))!) });
});

const deleteSchema = z.object({ id: z.string().min(1).max(64) }).strict();

/** Stop notifications on a device. */
export const DELETE = withUser(async (user, request) => {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const store = getStore().push_devices;
  const d = await store.get(parsed.data.id);
  if (d && d.user_id === user.id) await store.remove(d.id);
  return new Response(null, { status: 204 });
});
