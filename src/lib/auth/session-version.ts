// Edge-compatible (imported by middleware.ts): the owner's current session_version.
// Bumping it (password change, "sign out other devices") ends older sessions.

const CACHE_MS = 10_000;
let cached: { version: number; at: number } | null = null;

async function fetchVersion(origin: string): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && !url.includes("your-project")) {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/profile?id=eq.owner&select=session_version`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null; // e.g. the table isn't created yet: nothing to compare against
    const rows = (await res.json()) as Array<{ session_version?: number }>;
    return Number(rows[0]?.session_version ?? 1);
  }
  // File backend (self-hosted): ask the app itself.
  const res = await fetch(`${origin}/api/auth/session-version`, { cache: "no-store" });
  if (!res.ok) return null;
  return Number(((await res.json()) as { version?: number }).version ?? 1);
}

/** Current version, or null when it can't be determined (then the signed cookie alone decides). */
export async function currentSessionVersion(origin: string): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.version;
  try {
    const version = await fetchVersion(origin);
    if (version === null || !Number.isFinite(version)) return null;
    cached = { version, at: Date.now() };
    return version;
  } catch {
    return null;
  }
}
