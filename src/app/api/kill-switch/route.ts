import { NextResponse } from "next/server";
import { z } from "zod";

import { withUser } from "@/lib/auth/users";
import { zodError } from "@/lib/http";
import { setKillSwitch } from "@/lib/trading/engine";
import { getSettings } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ on: z.boolean() });

export const POST = withUser(async (user, request) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  await setKillSwitch(user.id, parsed.data.on);
  return NextResponse.json(await getSettings(user.id));
});
