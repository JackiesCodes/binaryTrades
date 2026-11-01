import { NextResponse } from "next/server";
import { z } from "zod";

import { getProfile, publicProfile } from "@/lib/auth/account";
import { zodError } from "@/lib/http";
import { getStore, log, nowIso } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  display_name: z.string().trim().max(60).nullable().optional(),
  email: z.union([z.string().trim().email().max(120), z.literal("")]).nullable().optional(),
});

export async function GET() {
  return NextResponse.json(publicProfile(await getProfile()));
}

export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  await getProfile();
  const patch: Record<string, string | null> = {};
  if (parsed.data.display_name !== undefined) patch.display_name = parsed.data.display_name || null;
  if (parsed.data.email !== undefined) patch.email = parsed.data.email || null;
  const updated = await getStore().profile.update("owner", { ...patch, updated_at: nowIso() });
  await log("info", "Profile updated");
  return NextResponse.json(publicProfile(updated!));
}
