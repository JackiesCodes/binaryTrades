import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { zodError } from "@/lib/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["render", "window", "promise", "global"]),
  message: z.string().max(500),
  stack: z.string().max(2000).optional(),
  path: z.string().max(200),
  ua: z.string().max(200).optional(),
  extra: z.string().max(200).optional(),
});

// A handful of reports per user per minute is plenty to find a bug; more is noise.
const recent = new Map<string, number[]>();
const LIMIT = 20;

/** Crashes and script errors from the browser, written to the server log as [client-error] lines. */
export const POST = withUser(async (user, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const now = Date.now();
  const times = (recent.get(user.id) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= LIMIT) return new Response(null, { status: 429 });
  recent.set(user.id, [...times, now]);
  const r = parsed.data;
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ⏎ ");
  console.error(
    `[client-error] ${r.kind} on ${clean(r.path)} (user ${user.id.slice(0, 8)}): ${clean(r.message)}` +
      `${r.extra ? ` [${clean(r.extra)}]` : ""} | ${clean(r.stack ?? "")} | ${clean(r.ua ?? "")}`,
  );
  return new Response(null, { status: 204 });
});
