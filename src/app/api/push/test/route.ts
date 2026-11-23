import { NextResponse } from "next/server";
import { z } from "zod";

import { rateLimited, withUser } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { pushEnabled, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";

const schema = z.object({ id: z.string().min(1).max(64) }).strict();

/** Send a test notification to one of the user's devices. */
export const POST = withUser(async (user, request) => {
  if (!pushEnabled()) return jsonError(503, "PUSH_NOT_CONFIGURED");
  if (rateLimited(`push-test:${user.id}`, 5, 60_000)) return jsonError(429, "TOO_MANY_REQUESTS");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const sent = await sendPush(
    user.id,
    null,
    { title: "binaryTrades", body: "Notifications are on. You'll hear about price alerts and trades here.", url: "/dashboard", tag: "test" },
    { only: parsed.data.id },
  );
  if (!sent) return jsonError(502, "PUSH_FAILED");
  return NextResponse.json({ sent });
});
