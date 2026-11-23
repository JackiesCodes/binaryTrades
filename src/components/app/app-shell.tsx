"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Bot,
  CandlestickChart,
  ChevronDown,
  Code2,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  LogOut,
  MoreHorizontal,
  PlugZap,
  ScrollText,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";

import { BrandMark, Wordmark } from "@/components/app/brand";
import { ConnectionBanner } from "@/components/app/connection-banner";
import { DashboardProvider, useDashboard } from "@/components/app/dashboard-context";
import { FeedbackProvider, useFeedback } from "@/components/app/feedback";
import { useKillSwitch } from "@/components/app/kill-switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reportClientError } from "@/lib/client-errors";
import { api, money, timeAgo } from "@/lib/client";
import { timeframeLabel } from "@/lib/trading/symbols";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: typeof Bot;
}

// Grouped by what you are doing: trading, building strategies, managing accounts and safety.
const NAV_GROUPS: NavItem[][] = [
  [
    { href: "/dashboard", label: "Overview", short: "Home", icon: LayoutDashboard },
    { href: "/dashboard/bots", label: "Bots", short: "Bots", icon: Bot },
    { href: "/dashboard/trades", label: "Trades", short: "Trades", icon: CandlestickChart },
    { href: "/dashboard/markets", label: "Markets", short: "Markets", icon: LineChart },
  ],
  [
    { href: "/dashboard/strategy-lab", label: "Strategy Lab", short: "Lab", icon: FlaskConical },
    { href: "/dashboard/scripts", label: "Scripts", short: "Scripts", icon: Code2 },
  ],
  [
    { href: "/dashboard/brokers", label: "Brokers", short: "Brokers", icon: PlugZap },
    { href: "/dashboard/risk", label: "Risk Guard", short: "Risk", icon: ShieldCheck },
    { href: "/dashboard/logs", label: "Alerts & Logs", short: "Logs", icon: ScrollText },
  ],
];
const ALL_NAV = NAV_GROUPS.flat();
const ACCOUNT_NAV: NavItem = { href: "/dashboard/account", label: "Account", short: "Account", icon: UserRound };
const ADMIN_NAV: NavItem = { href: "/dashboard/admin", label: "Admin", short: "Admin", icon: Users };

function useIsAdmin() {
  const { state } = useDashboard();
  return state?.meta.user.role === "admin";
}

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

/** Script errors outside React rendering (event handlers, timers, promises) go to the server log too. */
function useErrorReports() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, "window");
    const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, "promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useErrorReports();
  return (
    <FeedbackProvider>
      <DashboardProvider>
        <div className="flex min-h-[100dvh] flex-col">
          <PageTitle />
          <TopBar />
          <div className="flex flex-1">
            <Rail />
            <main className="mx-auto w-full min-w-0 max-w-[1680px] flex-1 px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 lg:pb-6 lg:pl-1 lg:pr-5">
              <ConnectionBanner />
              {children}
            </main>
          </div>
          <TabBar />
        </div>
      </DashboardProvider>
    </FeedbackProvider>
  );
}

/** Names the browser tab after the page ("Bots · binaryTrades"), or after the bot on a bot's page. */
function PageTitle() {
  const pathname = usePathname();
  const { state } = useDashboard();
  const botId = pathname.match(/^\/dashboard\/bots\/([^/]+)/)?.[1];
  const botName = botId ? state?.bots.find((b) => b.id === botId)?.name : undefined;
  const page = [...ALL_NAV, ACCOUNT_NAV, ADMIN_NAV].find((n) => n.href === pathname)?.label;
  const title = botName ?? (botId ? "Bot" : page);
  useEffect(() => {
    document.title = title ? `${title} · binaryTrades` : "binaryTrades";
  }, [title]);
  return null;
}

async function logout() {
  await api("/api/auth/logout", "POST").catch(() => undefined);
  window.location.href = "/";
}

// ---------------------------------------------------------------------------
// Icon rail (desktop)

// Hover labels are drawn on top of the page (not inside their button), so a scrolling or clipped
// container — like the rail, which scrolls on short screens — can never cut them off.
function useHoverTip(label: string, side: "right" | "below" = "right") {
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const pathname = usePathname();
  useEffect(() => setPos(null), [pathname]);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);
  const open = (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (side === "right") setPos({ left: r.right + 10, top: r.top + r.height / 2, transform: "translateY(-50%)" });
    // Below: centred under the item, or right-aligned with it near the screen's right edge.
    else if (r.left + r.width / 2 > window.innerWidth - 110) setPos({ right: window.innerWidth - r.right, top: r.bottom + 8 });
    else setPos({ left: r.left + r.width / 2, top: r.bottom + 8, transform: "translateX(-50%)" });
  };
  const close = () => setPos(null);
  const tip = pos
    ? createPortal(
        <span
          role="tooltip"
          style={pos}
          className="pointer-events-none fixed z-[60] whitespace-nowrap rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-ivory shadow-lg ring-1 ring-white/10"
        >
          {label}
        </span>,
        document.body,
      )
    : null;
  return { props: { onMouseEnter: open, onFocus: open, onMouseLeave: close, onBlur: close }, tip };
}

function RailLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const { props, tip } = useHoverTip(item.label);
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      {...props}
      className={cn(
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors [@media(max-height:760px)]:h-9 [@media(max-height:760px)]:w-9",
        active ? "bg-profit text-ink" : "text-muted-foreground hover:bg-white/[0.06] hover:text-ivory",
      )}
    >
      <Icon className="h-[19px] w-[19px]" />
      {tip}
    </Link>
  );
}

function SignOutButton() {
  const { props, tip } = useHoverTip("Sign out");
  return (
    <button
      onClick={logout}
      aria-label="Sign out"
      {...props}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-loss [@media(max-height:760px)]:h-9 [@media(max-height:760px)]:w-9"
    >
      <LogOut className="h-[19px] w-[19px]" />
      {tip}
    </button>
  );
}

function Rail() {
  const admin = useIsAdmin();
  return (
    <nav
      aria-label="Main"
      className="no-scrollbar sticky top-[var(--header-h,64px)] hidden h-[calc(100dvh-var(--header-h,64px))] w-[76px] shrink-0 flex-col items-center gap-3 overflow-y-auto overflow-x-hidden py-3 lg:flex [@media(max-height:760px)]:gap-2 [@media(max-height:760px)]:py-2"
    >
      {NAV_GROUPS.map((group, i) => (
        <div key={i} className="flex shrink-0 flex-col gap-1 rounded-[26px] bg-panel p-1.5">
          {group.map((item) => (
            <RailLink key={item.href} item={item} />
          ))}
        </div>
      ))}
      <div className="mt-auto flex shrink-0 flex-col gap-1 rounded-[26px] bg-panel p-1.5">
        {admin && <RailLink item={ADMIN_NAV} />}
        <RailLink item={ACCOUNT_NAV} />
        <SignOutButton />
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Top bar

const chip = "inline-flex h-10 items-center gap-2 rounded-xl bg-panel px-3.5 text-sm text-ivory";

function Logo() {
  return (
    <Link href="/dashboard" className="flex min-h-10 min-w-10 shrink-0 items-center gap-2 text-base lg:w-[170px] lg:text-lg">
      <BrandMark />
      {/* Phones: just the mark, so search and the alerts bell fit in the top bar. */}
      <span className="hidden sm:inline">
        <Wordmark />
      </span>
    </Link>
  );
}

/** Keeps --header-h in sync with the top bar's real height (banners make it taller). */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

function TopBar() {
  const kill = useKillSwitch();
  const ref = useHeaderHeight();
  return (
    <header ref={ref} className="sticky top-0 z-30 bg-ink/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2.5 px-3 sm:px-5 lg:h-16 lg:gap-3">
        <Logo />
        <div className="hidden min-w-0 max-w-[460px] flex-1 md:block">
          <SearchBox />
        </div>
        <div className="flex-1" />
        <PhoneSearch />
        <AlertsBell />
        <EquityChip />
        <BookSwitch />
        <Profile />
      </div>
      <AccountBanner />
      {kill.on && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-loss/10 px-4 py-2 text-center text-xs font-medium text-loss sm:text-sm">
          <span>Kill switch is ON — no new trades will be placed.</span>
          <button onClick={kill.toggle} disabled={kill.busy} className="font-semibold underline">
            Release
          </button>
        </div>
      )}
    </header>
  );
}

function EquityChip() {
  const { state, view } = useDashboard();
  const { props, tip } = useHoverTip(`${view === "real" ? "Real" : "Demo"} equity · Brokers`, "below");
  if (!state?.brokers.length) return null;
  return (
    <Link href="/dashboard/brokers" className={cn(chip, "px-3 font-mono tabular-nums")} {...props}>
      {tip}
      <Wallet className="h-4 w-4 text-muted-foreground" />
      <span className="hidden sm:inline">{money(state.kpis[view].equity)}</span>
      <span className="sm:hidden">{money(Math.round(state.kpis[view].equity)).replace(/\.00$/, "")}</span>
    </Link>
  );
}

/** Real or demo accounts: one switch that every page follows. */
function BookSwitch() {
  const { state, view, setView } = useDashboard();
  const { props: tipProps, tip } = useHoverTip(`Switch to ${view === "real" ? "demo" : "real"} accounts`, "below");
  const hasReal = state?.brokers.some((b) => !b.is_demo);
  const hasDemo = state?.brokers.some((b) => b.is_demo);
  if (!state || !(hasReal || hasDemo)) return null;
  const both = hasReal && hasDemo;
  return (
    <button
      type="button"
      onClick={() => both && setView(view === "real" ? "demo" : "real")}
      disabled={!both}
      className={cn(chip, "hidden lg:inline-flex", both && "hover:bg-white/[0.06]")}
      {...(both ? tipProps : {})}
    >
      {both && tip}
      <span
        className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", view === "real" ? "bg-gold text-ink" : "bg-white/10 text-ivory")}
      >
        {view === "real" ? "REAL" : "DEMO"}
      </span>
      {view === "real" ? "Real accounts" : "Demo accounts"}
      {both && <ChevronDown className="h-4 w-4 text-muted-foreground" />}
    </button>
  );
}

function AlertsBell() {
  const { state } = useDashboard();
  const since = Date.now() - 24 * 3600_000;
  const recent = state?.logs.filter((l) => (l.level === "error" || l.level === "warn" || l.level === "alert") && Date.parse(l.created_at) > since).length ?? 0;
  const label = recent ? `Alerts & Logs: ${recent} alert${recent === 1 ? "" : "s"} or warning${recent === 1 ? "" : "s"} in the last 24 hours` : "Alerts & Logs";
  const { props, tip } = useHoverTip(label, "below");
  return (
    <Link href="/dashboard/logs" aria-label={label} className={cn(chip, "relative inline-flex w-10 justify-center px-0")} {...props}>
      {tip}
      <Bell className="h-4 w-4 text-muted-foreground" />
      {recent > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-gold" />}
    </Link>
  );
}

function Profile() {
  const { state, lastTick, error } = useDashboard();
  const user = state?.meta.user;
  const name = user?.display_name?.trim() || user?.email?.split("@")[0] || "Account";
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p: string) => p[0]!.toUpperCase())
    .join("");
  const ok = !error && Boolean(lastTick);
  const { props, tip } = useHoverTip(`Account · ${ok ? "engine on" : "engine connecting"}`, "below");
  return (
    <Link href="/dashboard/account" aria-label={`Account: ${name}`} className="flex shrink-0 items-center gap-2.5 rounded-xl pl-1 lg:pr-1" {...props}>
      {tip}
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-profit/15 text-sm font-semibold text-profit lg:h-10 lg:w-10">
        {initials || "·"}
        <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink", ok ? "bg-profit" : "bg-amber-300")} aria-hidden />
      </span>
      <span className="hidden min-w-0 leading-tight xl:block">
        <span className="block max-w-[140px] truncate text-sm font-semibold text-ivory">{name}</span>
        <span className={cn("block text-[11px]", ok ? "text-muted-foreground" : "text-amber-300")}>
          {ok ? `Engine on · ${timeAgo(lastTick)}` : "Engine connecting…"}
        </span>
      </span>
    </Link>
  );
}

/** Jump to a page or a bot. */
/** Phones: a search button that opens the same search, full width over the top bar. */
function PhoneSearch() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search bots and pages" className={cn(chip, "w-10 justify-center px-0 md:hidden")}>
        <Search className="h-4 w-4 text-muted-foreground" />
      </button>
      {/* Rendered at page level: the top bar's blur would otherwise trap the backdrop inside the bar. */}
      {open &&
        createPortal(
          <>
            {open && <button type="button" aria-label="Close search" onClick={() => setOpen(false)} className="fixed inset-0 z-50 bg-black/50 md:hidden" />}
            {open && (
              <div
                className="fixed inset-x-0 top-0 z-50 bg-ink/95 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-2xl backdrop-blur-xl md:hidden"
                role="dialog"
                aria-label="Search"
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBox autoFocus fullWidth onClose={() => setOpen(false)} />
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="h-10 shrink-0 rounded-xl px-3 text-sm text-muted-foreground hover:text-ivory">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}

function SearchBox({ autoFocus = false, fullWidth = false, onClose }: { autoFocus?: boolean; fullWidth?: boolean; onClose?: () => void } = {}) {
  const { state } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  // The full placeholder only where the box is wide enough for it (it was cut off on tablets).
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const set = () => setWide(mq.matches || fullWidth);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, [fullWidth]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setQ("");
  }, [pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const pages = [...ALL_NAV, ACCOUNT_NAV]
      .filter((n) => n.label.toLowerCase().includes(term))
      .map((n) => ({ href: n.href, label: n.label, sub: "Page", icon: n.icon }));
    const bots = (state?.bots ?? [])
      .filter((b) => `${b.name} ${b.symbol} ${b.data_symbol}`.toLowerCase().includes(term))
      .map((b) => ({ href: `/dashboard/bots/${b.id}`, label: b.name, sub: `Bot · ${b.symbol} · ${timeframeLabel(b.timeframe)}`, icon: Bot }));
    return [...bots, ...pages].slice(0, 8);
  }, [q, state?.bots]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={box} className="relative min-w-0">
      <label className="flex h-10 items-center gap-2.5 rounded-xl bg-panel px-3.5 text-sm text-muted-foreground focus-within:ring-1 focus-within:ring-profit/40">
        <Search className="h-4 w-4 shrink-0" />
        <input
          size={1}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, results.length - 1));
            else if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
            else if (e.key === "Enter" && results[hi]) go(results[hi]!.href);
            else if (e.key === "Escape") {
              setOpen(false);
              onClose?.();
            }
          }}
          autoFocus={autoFocus}
          placeholder={wide ? "Search bots and pages" : "Search"}
          aria-label="Search bots and pages"
          className="min-w-0 flex-1 bg-transparent text-base text-ivory placeholder:text-muted-foreground focus:outline-none md:text-sm"
        />
      </label>
      {open && q.trim() && (
        <div
          className={cn(
            "absolute left-0 top-12 z-50 overflow-hidden rounded-xl bg-panel p-1 shadow-2xl ring-1 ring-white/10",
            fullWidth ? "right-0" : "w-[360px] min-w-full max-w-[calc(100vw-24px)]",
          )}
        >
          {results.length ? (
            results.map((r, i) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.href}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => go(r.href)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 text-left text-sm",
                    fullWidth ? "min-h-12 py-2.5" : "py-2",
                    i === hi && "bg-white/[0.06]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-profit" />
                  {fullWidth ? (
                    // Phones: name and details on two lines, so neither is cut short.
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ivory">{r.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>
                    </span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-ivory">{r.label}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{r.sub}</span>
                    </>
                  )}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-2.5 text-sm text-muted-foreground">No bots or pages match “{q.trim()}”.</div>
          )}
        </div>
      )}
    </div>
  );
}

function AccountBanner() {
  const { state } = useDashboard();
  const { toast } = useFeedback();
  const user = state?.meta.user;
  if (!user) return null;
  if (!user.email) {
    return (
      <div className="bg-gold/10 px-4 py-2 text-center text-xs text-gold sm:text-sm">
        Add your email address to finish upgrading your account.{" "}
        <Link href="/dashboard/account" className="font-semibold underline">
          Add email
        </Link>
      </div>
    );
  }
  if (user.email_verified) return null;
  const resend = async () => {
    try {
      await api("/api/auth/resend-verification", "POST");
      toast(`Confirmation email sent to ${user.email}`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="bg-gold/10 px-4 py-2 text-center text-xs text-gold sm:text-sm">
      Confirm your email ({user.email}) to connect broker accounts.{" "}
      <button onClick={resend} className="font-semibold underline">
        Resend the link
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phone tab bar

// Phone tabs: Home, Bots, Trades, Brokers; everything else is under More.
// Phone tab bar: the pages used most on the go. Everything else (Brokers, Risk Guard, Logs…) is under More.
const TABS = ["/dashboard", "/dashboard/bots", "/dashboard/markets", "/dashboard/trades"];

function TabBar() {
  const pathname = usePathname();
  const admin = useIsAdmin();
  const { state, view, setView } = useDashboard();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = TABS.map((h) => ALL_NAV.find((n) => n.href === h)!);
  const more = [...ALL_NAV.filter((n) => !TABS.includes(n.href)), ACCOUNT_NAV, ...(admin ? [ADMIN_NAV] : [])];
  const moreActive = more.some((n) => isActive(pathname, n.href));
  const both = state?.brokers.some((b) => b.is_demo) && state?.brokers.some((b) => !b.is_demo);

  useEffect(() => setMoreOpen(false), [pathname]);

  const tab = (active: boolean, Icon: typeof Bot, label: string) => (
    <>
      <span className={cn("flex h-8 w-12 items-center justify-center rounded-full transition-colors", active && "bg-profit text-ink")}>
        <Icon className="h-[19px] w-[19px]" />
      </span>
      {label}
    </>
  );

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-5 px-1 pb-1.5 pt-2">
          {tabs.map(({ href, short, icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 text-[11px] font-medium", active ? "text-profit" : "text-muted-foreground")}
              >
                {tab(active, icon, short)}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn("flex flex-col items-center gap-1 text-[11px] font-medium", moreActive ? "text-profit" : "text-muted-foreground")}
          >
            {tab(moreActive, MoreHorizontal, "More")}
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="lg:hidden [@media(max-height:500px)]:gap-3 [@media(max-height:500px)]:p-4">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
          </DialogHeader>
          {both && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-sm font-semibold">
              {(["demo", "real"] as const).map((b) => (
                <button
                  key={b}
                  aria-pressed={view === b}
                  onClick={() => setView(b)}
                  className={cn("min-h-11 rounded-lg py-2", view === b ? (b === "real" ? "bg-gold text-ink" : "bg-profit text-ink") : "text-muted-foreground")}
                >
                  {b === "real" ? "Real accounts" : "Demo accounts"}
                </button>
              ))}
            </div>
          )}
          {/* One column; two on short screens (a phone held sideways) so Sign out never hides below the edge. */}
          <div className="grid gap-px overflow-hidden rounded-xl bg-white/5 [@media(max-height:500px)]:grid-cols-2">
            {more.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex items-center gap-3 bg-[#151E1A] px-4 py-3.5 text-sm", active ? "text-profit" : "text-foreground")}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-profit" : "text-muted-foreground")} />
                  {label}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className={cn(
                "flex w-full items-center gap-3 bg-[#151E1A] px-4 py-3.5 text-left text-sm text-loss",
                // In two columns, fill the last row instead of leaving an empty cell beside it.
                more.length % 2 === 0 && "[@media(max-height:500px)]:col-span-2",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" /> Sign out
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
