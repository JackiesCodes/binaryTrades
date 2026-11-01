import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isAuthConfigured, readSessionToken } from "@/lib/auth/session";

// Public pages and machine endpoints (webhook passphrase, MT5 bridge key and cron
// secret authenticate themselves). Everything else needs a signed-in user.
const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/webhooks/",
  "/api/mt5/",
  "/api/cron/",
  "/downloads/",
  "/icons/",
  "/legal/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-icon",
  "/robots.txt",
  "/sitemap.xml",
];
const PUBLIC_PAGES = new Set(["/", "/forgot-password", "/reset-password", "/verify-email"]);
// Signed-in visitors skip these and go straight to their dashboard.
const AUTH_PAGES = new Set(["/login", "/signup"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PAGES.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!isAuthConfigured()) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("binaryTrades is being set up. Please check back soon.", { status: 503 });
  }

  // The signature is checked here; the API checks the session version and account status on every call.
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (AUTH_PAGES.has(pathname)) {
    return session ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  if (session) return NextResponse.next();

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
