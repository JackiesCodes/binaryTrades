import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isAuthConfigured, readSessionToken } from "@/lib/auth/session";
import { currentSessionVersion } from "@/lib/auth/session-version";

// Machine-to-machine endpoints authenticate themselves (webhook passphrase,
// MT5 bridge key, cron secret) and must stay reachable without a browser session.
const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/webhooks/", "/api/mt5/", "/api/cron/", "/downloads/", "/icons/", "/manifest.webmanifest", "/icon.svg", "/apple-icon"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!isAuthConfigured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Set APP_PASSWORD to protect your trading dashboard before deploying.", { status: 503 });
  }

  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    // Versions only go up, so a cookie newer than a cached value is still valid.
    const current = await currentSessionVersion(request.nextUrl.origin);
    if (current === null || session.version >= current) return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
