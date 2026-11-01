import { NextResponse } from "next/server";
import { z } from "zod";

import { bumpSessions, getUser, withAdmin } from "@/lib/auth/users";
import { jsonError, zodError } from "@/lib/http";
import { setKillSwitch } from "@/lib/trading/engine";
import { log } from "@/lib/trading/store";

export const dynamic = "force-dynamic";

const schema = z.object({ disabled: z.boolean().optional(), role: z.enum(["user", "admin"]).optional() });

/** Admin: disable / re-enable an account, or change its role. Disabling stops its bots and signs it out. */
export const PATCH = withAdmin<{ params: { id: string } }>(async (admin, request, { params }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodError(parsed.error);
  const target = await getUser(params.id);
  if (!target) return jsonError(404, "USER_NOT_FOUND");
  if (target.id === admin.id) return jsonError(409, "CANNOT_CHANGE_YOURSELF");
  const updated = await bumpSessions(target, parsed.data);
  if (parsed.data.disabled === true) {
    await setKillSwitch(target.id, true, "Account disabled by an administrator");
  }
  await log("warn", `Admin ${admin.email ?? admin.id} updated ${target.email ?? target.id}: ${JSON.stringify(parsed.data)}`, { user_id: admin.id });
  return NextResponse.json({ id: updated.id, disabled: updated.disabled, role: updated.role });
});
