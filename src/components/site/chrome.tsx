import Link from "next/link";

import { BrandMark, Wordmark } from "@/components/app/brand";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg" aria-label="binaryTrades home">
          <BrandMark />
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex" aria-label="Site">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/#how-it-works" className="hover:text-foreground">
            How it works
          </Link>
          <Link href="/#security" className="hover:text-foreground">
            Security
          </Link>
          <Link href="/#faq" className="hover:text-foreground">
            FAQ
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <footer className="border-t border-white/5 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="flex items-center gap-2 text-base">
              <BrandMark className="h-6 w-6" />
              <Wordmark />
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">
              Automation and risk control for traders on Deriv, MetaTrader 5 and TradingView. Your money always stays with your broker.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:gap-16">
            <div className="space-y-2">
              <div className="font-semibold text-ivory">Product</div>
              <Link href="/#features" className="block text-muted-foreground hover:text-foreground">
                Features
              </Link>
              <Link href="/#security" className="block text-muted-foreground hover:text-foreground">
                Security
              </Link>
              <Link href="/signup" className="block text-muted-foreground hover:text-foreground">
                Create account
              </Link>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-ivory">Legal</div>
              <Link href="/legal/terms" className="block text-muted-foreground hover:text-foreground">
                Terms of Use
              </Link>
              <Link href="/legal/privacy" className="block text-muted-foreground hover:text-foreground">
                Privacy Policy
              </Link>
              <Link href="/legal/risk" className="block text-muted-foreground hover:text-foreground">
                Risk Disclosure
              </Link>
              {support && (
                <a href={`mailto:${support}`} className="block text-muted-foreground hover:text-foreground">
                  Contact support
                </a>
              )}
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-white/5 pt-6 text-xs leading-relaxed text-muted-foreground">
          <b className="text-ivory">Risk warning:</b> Trading forex, CFDs, multipliers and synthetic indices carries a high level of risk and can result in
          the loss of all your invested capital. Automated strategies can lose money, and past or backtested performance does not guarantee future
          results. binaryTrades is software, not a broker or financial adviser: it does not hold client funds or give investment advice. Only trade
          with money you can afford to lose. <Link href="/legal/risk" className="underline">Read the full Risk Disclosure</Link>.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} binaryTrades. Deriv, MetaTrader, Exness and TradingView are trademarks of their respective owners; binaryTrades is not affiliated with them.</p>
      </div>
    </footer>
  );
}

/** Centered card used by the sign-in, sign-up and email-link pages. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-4 py-[max(2rem,env(safe-area-inset-top))]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-engraving [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_65%)]" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 flex flex-col items-center text-center" aria-label="binaryTrades home">
          <BrandMark className="h-12 w-12" />
          <Wordmark className="mt-3 text-xl" />
        </Link>
        <div className="glass-panel p-6">
          <h1 className="text-lg font-semibold text-ivory">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        <p className="mt-6 text-center text-xs text-muted-foreground">
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
      </div>
    </main>
  );
}
