import "server-only";

import { verifyPassword } from "@/lib/auth/password";
import { checkEnvPassword } from "@/lib/auth/session";
import { getStore, nowIso } from "@/lib/trading/store";
import type { Profile } from "@/lib/trading/types";

export async function getProfile(): Promise<Profile> {
  const store = getStore();
  const existing = await store.profile.get("owner");
  if (existing) return existing;
  const fresh: Profile = {
    id: "owner",
    display_name: null,
    email: null,
    password_hash: null,
    password_changed_at: null,
    session_version: 1,
    updated_at: nowIso(),
  };
  try {
    return await store.profile.insert(fresh);
  } catch {
    // Two requests raced to create it.
    return (await store.profile.get("owner")) ?? fresh;
  }
}

/** The owner's password once they've set one; APP_PASSWORD until then. */
export async function checkLoginPassword(candidate: string, profile?: Profile): Promise<boolean> {
  const p = profile ?? (await getProfile());
  return p.password_hash ? verifyPassword(candidate, p.password_hash) : checkEnvPassword(candidate);
}

/** What the browser may see. */
export function publicProfile(p: Profile) {
  return {
    display_name: p.display_name,
    email: p.email,
    password_source: p.password_hash ? ("custom" as const) : ("app_password" as const),
    password_changed_at: p.password_changed_at,
  };
}
export type PublicProfile = ReturnType<typeof publicProfile>;
