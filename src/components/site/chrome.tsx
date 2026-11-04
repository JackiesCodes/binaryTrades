import Link from "next/link";
import { ArrowLeft, KeyRound, Lock, ShieldCheck, Wallet } from "lucide-react";

import { BrandMark, Wordmark } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { DashboardPreview } from "@/components/site/dashboard-preview";

const SITE_LINKS = [
  ["/#features", "Features"],
  ["/#how-it-works", "How it works"],
  ["/#security", "Security"],
  ["/#faq", "FAQ"],
] as const;

export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  return (
    <header className="sticky top-0 z-30 bg-ink/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-3 sm:px-5">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg"
          aria-label="binaryTrades home"
        >
          <BrandMark />
          <Wordmark />
        </Link>
        {minimal ? (
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-panel px-4 text-sm text-muted-foreground hover:text-ivory"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        ) : (
          <>
            <nav
              className="hidden items-center gap-1 rounded-xl bg-panel p-1 text-sm text-muted-foreground md:flex"
              aria-label="Site"
            >
              {SITE_LINKS.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg px-3.5 py-1.5 hover:bg-white/[0.06] hover:text-ivory"
                >
                  {label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-10 rounded-xl bg-panel px-4 hover:bg-white/[0.06]"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button
                size="sm"
                asChild
                className="h-10 rounded-xl px-4 font-bold"
              >
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <footer className="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
      <div className="mx-auto max-w-[1240px] rounded-[22px] bg-panel px-5 py-10 sm:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="flex items-center gap-2 text-base">
              <BrandMark className="h-6 w-6" />
              <Wordmark />
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Automation and risk control for traders on Deriv, MetaTrader 5 and
              TradingView. Your money always stays with your broker.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:gap-16">
            <div className="space-y-2">
              <div className="font-semibold text-ivory">Product</div>
              <Link
                href="/#features"
                className="block text-muted-foreground hover:text-foreground"
              >
                Features
              </Link>
              <Link
                href="/#security"
                className="block text-muted-foreground hover:text-foreground"
              >
                Security
              </Link>
              <Link
                href="/signup"
                className="block text-muted-foreground hover:text-foreground"
              >
                Create account
              </Link>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-ivory">Legal</div>
              <Link
                href="/legal/terms"
                className="block text-muted-foreground hover:text-foreground"
              >
                Terms of Use
              </Link>
              <Link
                href="/legal/privacy"
                className="block text-muted-foreground hover:text-foreground"
              >
                Privacy Policy
              </Link>
              <Link
                href="/legal/risk"
                className="block text-muted-foreground hover:text-foreground"
              >
                Risk Disclosure
              </Link>
              {support && (
                <a
                  href={`mailto:${support}`}
                  className="block text-muted-foreground hover:text-foreground"
                >
                  Contact support
                </a>
              )}
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-white/5 pt-6 text-xs leading-relaxed text-muted-foreground">
          <b className="text-ivory">Risk warning:</b> Trading forex, CFDs,
          multipliers and synthetic indices carries a high level of risk and can
          result in the loss of all your invested capital. Automated strategies
          can lose money, and past or backtested performance does not guarantee
          future results. binaryTrades is software, not a broker or financial
          adviser: it does not hold client funds or give investment advice. Only
          trade with money you can afford to lose.{" "}
          <Link href="/legal/risk" className="underline">
            Read the full Risk Disclosure
          </Link>
          .
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          © {new Date().getFullYear()} binaryTrades. Deriv, MetaTrader, Exness
          and TradingView are trademarks of their respective owners;
          binaryTrades is not affiliated with them.
        </p>
      </div>
    </footer>
  );
}

/**
 * Layout for the sign-in, sign-up and email-link pages: the site header, the form in a
 * panel, and (for sign-in / sign-up) a side panel with an example of the dashboard.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  mode,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Sign-in / sign-up get the switch between them and the side panel. */
  mode?: "login" | "signup";
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader minimal />
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-3 pb-6 sm:px-5">
        <div
          className={
            mode
              ? "grid flex-1 items-stretch gap-3.5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]"
              : "flex flex-1 items-start justify-center pt-6 sm:pt-12"
          }
        >
          <section
            className={
              mode
                ? "flex flex-col rounded-[22px] bg-panel p-5 sm:p-8"
                : "w-full max-w-md rounded-[22px] bg-panel p-5 sm:p-8"
            }
          >
            {mode && (
              <div
                className="mb-7 grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-sm"
                role="tablist"
              >
                {(
                  [
                    ["login", "/login", "Sign in"],
                    ["signup", "/signup", "Create account"],
                  ] as const
                ).map(([m, href, label]) => (
                  <Link
                    key={m}
                    href={href}
                    role="tab"
                    aria-selected={mode === m}
                    className={
                      mode === m
                        ? "rounded-[9px] bg-profit py-2 text-center font-semibold text-ink"
                        : "rounded-[9px] py-2 text-center font-medium text-muted-foreground hover:text-ivory"
                    }
                  >
                    {label}
                  </Link>
                ))}
              </div>
            )}
            <h1 className="text-2xl font-bold tracking-tight text-ivory">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
            )}
            <div className="mt-6">{children}</div>
            {footer && (
              <div className="mt-6 text-center text-sm text-muted-foreground">
                {footer}
              </div>
            )}
            <p className="mt-auto pt-8 text-center text-xs text-muted-foreground">
              <Link href="/legal/terms" className="hover:text-foreground">
                Terms
              </Link>{" "}
              ·{" "}
              <Link href="/legal/privacy" className="hover:text-foreground">
                Privacy
              </Link>{" "}
              ·{" "}
              <Link href="/legal/risk" className="hover:text-foreground">
                Risk Disclosure
              </Link>
            </p>
          </section>
          {mode && <AuthAside />}
        </div>
      </main>
    </div>
  );
}

const SAFETY = [
  {
    icon: KeyRound,
    title: "Trade-only access",
    body: "Deriv tokens need only the trade scope — nothing here can withdraw.",
  },
  {
    icon: Lock,
    title: "Encrypted keys",
    body: "Broker tokens are encrypted with AES-256-GCM on the server.",
  },
  {
    icon: ShieldCheck,
    title: "Risk Guard on every order",
    body: "Daily loss, drawdown and open-trade limits, checked first.",
  },
  {
    icon: Wallet,
    title: "Your money stays put",
    body: "Funds stay with your broker. binaryTrades is software, not a broker.",
  },
];

function AuthAside() {
  return (
    <aside className="relative hidden flex-col gap-5 overflow-hidden rounded-[22px] bg-panel p-8 lg:flex">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-engraving opacity-40 [mask-image:radial-gradient(ellipse_at_top_right,black_10%,transparent_65%)]"
      />
      <div className="relative">
        <div className="inline-flex rounded-full bg-profit/10 px-3 py-1 text-xs font-semibold text-profit">
          Free during beta
        </div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-ivory">
          Automate your trading. Keep control of the risk.
        </h2>
      </div>
      <div className="relative">
        <DashboardPreview />
      </div>
      <dl className="relative grid grid-cols-2 gap-3">
        {SAFETY.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex gap-3 rounded-[14px] bg-black/25 p-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-gold">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <dt className="text-sm font-semibold text-ivory">{title}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">
                {body}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </aside>
  );
}
