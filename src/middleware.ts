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

// When PRIMARY_HOST is set (e.g. binarytrades.trading), people on the old address are sent
// there, while machine endpoints (MT5 bridges, TradingView webhooks, the scheduler) keep
// working on the old address so nothing breaks mid-move.
const PRIMARY_HOST = process.env.PRIMARY_HOST;
const LEGACY_HOSTS = new Set(["binarytrades.vercel.app"]);
const MACHINE_PREFIXES = ["/api/", "/downloads/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host")?.split(":")[0] ?? "";
  if (PRIMARY_HOST && LEGACY_HOSTS.has(host) && !MACHINE_PREFIXES.some((p) => pathname.startsWith(p))) {
    const url = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${PRIMARY_HOST}`);
    return NextResponse.redirect(url, 308);
  }
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
