import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CandlestickChart,
  Code2,
  FlaskConical,
  KeyRound,
  Lock,
  Octagon,
  PlugZap,
  ShieldCheck,
  Sparkles,
  Webhook,
} from "lucide-react";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Bot,
    title: "Strategy bots",
    body: "Trend, breakout and mean-reversion strategies that trade on their own, on every closed candle, with a stop on every trade.",
  },
  {
    icon: Code2,
    title: "Your own scripts",
    body: "Write or paste a strategy in JavaScript, test it on real price history, and turn it into a bot in one click. Scripts run in a locked sandbox.",
  },
  {
    icon: Webhook,
    title: "TradingView alerts",
    body: "Point your Pine Script alerts at a bot and they execute on your account — or let a script check each alert before it trades.",
  },
  {
    icon: PlugZap,
    title: "Deriv and MetaTrader 5",
    body: "Deriv through its official API, and Exness or any MT5 broker through a small bridge Expert Advisor in your terminal.",
  },
  {
    icon: ShieldCheck,
    title: "Risk Guard",
    body: "Risk per trade, a daily loss limit, a drawdown limit and open-trade caps — checked before any order reaches your broker.",
  },
  {
    icon: Octagon,
    title: "One-tap kill switch",
    body: "Pause every bot and close every position — including positions from your other EAs on MT5 — from your phone.",
  },
];

const STEPS = [
  { title: "Create your account", body: "Free, with just an email address." },
  { title: "Connect a demo account", body: "Deriv with a trade-only token, or MT5 with the bridge EA. Real or demo is decided by the account you connect." },
  { title: "Test before you trade", body: "Backtest a strategy or your script on real prices. The Strategy Lab ranks strategies on data they were not tuned on." },
  { title: "Start a bot", body: "Watch it on the dashboard. When its demo results hold up, move it to a real account with small risk." },
];

const FAQ = [
  {
    q: "Is binaryTrades a broker? Where is my money?",
    a: "No. binaryTrades is software that places orders on broker accounts you connect. Your money stays with your broker (Deriv, Exness or another MT5 broker) at all times. We never hold funds and cannot withdraw from your accounts.",
  },
  {
    q: "Can it guarantee profits?",
    a: "No — and you should be wary of anyone who says otherwise. Every strategy loses money some of the time, and backtests can overstate results. That's why binaryTrades shows results on unseen data, starts you on demo accounts, and enforces loss limits.",
  },
  {
    q: "Do you need my broker password?",
    a: "No. For Deriv you create a Personal Access Token with the trade scope only (no payments or withdrawals). For MetaTrader 5 the bridge EA uses a key generated on your Brokers page. Tokens are encrypted at rest with AES-256-GCM and never shown again.",
  },
  {
    q: "Does my computer need to stay on?",
    a: "Not for Deriv: Deriv bots run in the cloud. MetaTrader 5 has no cloud API, so your MT5 terminal (on your PC or a Windows VPS) must stay running with the bridge EA attached.",
  },
  {
    q: "Can I use my own strategy?",
    a: "Yes. Write it in JavaScript in the Scripts editor (examples included), test it on real history, and create a bot from it. Pine Script strategies run through TradingView alerts instead.",
  },
  {
    q: "What does it cost?",
    a: "binaryTrades is free while it is in beta. Your broker's normal spreads, commissions and fees still apply to your trades.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-engraving opacity-60 [mask-image:radial-gradient(ellipse_at_top,black_15%,transparent_70%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-profit/30 bg-profit/10 px-3 py-1 text-xs font-medium text-profit">
                <Sparkles className="h-3.5 w-3.5" /> Free during beta
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-ivory sm:text-5xl">
                Automate your trading.
                <br />
                <span className="text-profit">Keep control of the risk.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Connect your Deriv and MetaTrader 5 accounts, run strategy bots or your own scripts, execute TradingView alerts — and let Risk Guard
                enforce your limits around the clock, from one dashboard.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link href="/signup">
                    Create a free account <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/#how-it-works">See how it works</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">No card required · Start on a demo account · Your funds stay with your broker</p>
            </div>
            <FlowDiagram />
          </div>
        </section>

        {/* Brokers */}
        <section className="border-y border-white/5 bg-white/[0.015]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
            <span className="text-xs uppercase tracking-widest">Works with</span>
            <span className="font-semibold text-ivory">Deriv</span>
            <span className="font-semibold text-ivory">MetaTrader 5</span>
            <span className="font-semibold text-ivory">Exness</span>
            <span className="font-semibold text-ivory">TradingView</span>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionTitle eyebrow="Features" title="Everything between your idea and your broker" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="glass-panel p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-profit/10 text-profit">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold text-ivory">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Honest testing */}
        <section className="border-y border-white/5 bg-white/[0.015]">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <SectionTitle eyebrow="Strategy Lab" title="Tested on data it has never seen" align="left" />
              <p className="mt-4 text-muted-foreground">
                Tuning a strategy on past prices always looks good. The Strategy Lab tunes every strategy on the first 70% of the history and ranks
                them only on the 30% they never saw — with trading costs included — so you see results closer to what live trading looks like.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Real price history from Deriv for forex, gold, crypto and synthetic indices
                </li>
                <li className="flex gap-2">
                  <CandlestickChart className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Return, drawdown, win rate, profit factor and every simulated trade
                </li>
                <li className="flex gap-2">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Turn the result into a bot on a demo account in one click
                </li>
              </ul>
            </div>
            <div className="glass-panel p-6 text-sm">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">How results are measured</div>
              <div className="mt-4 flex h-10 overflow-hidden rounded-lg text-xs font-medium">
                <div className="flex w-[70%] items-center justify-center bg-white/10 text-muted-foreground">Tuning data · 70%</div>
                <div className="flex w-[30%] items-center justify-center bg-profit/25 text-profit">Unseen · 30%</div>
              </div>
              <p className="mt-4 text-muted-foreground">
                Only the unseen 30% decides the ranking. Strategies with too few trades are flagged. Then run it on demo for 2–4 weeks before real money.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionTitle eyebrow="How it works" title="From sign-up to your first bot in minutes" />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="glass-panel p-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-profit/40 font-mono text-sm text-profit">{i + 1}</div>
                <h3 className="mt-4 font-semibold text-ivory">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 border-y border-white/5 bg-white/[0.015]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Security" title="Built so that a mistake can't empty your account" />
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SecurityItem icon={KeyRound} title="Trade-only access" body="Deriv tokens need only the trade scope. Nothing here can withdraw or transfer money." />
              <SecurityItem icon={Lock} title="Encrypted keys" body="Broker tokens are encrypted with AES-256-GCM and never leave the server. MT5 bridge keys are stored as hashes." />
              <SecurityItem icon={Code2} title="Sandboxed scripts" body="Scripts run in an isolated engine with no internet, file or key access, and strict time and memory limits." />
              <SecurityItem icon={ShieldCheck} title="Your account, your data" body="Each account is fully separated. Passwords are salted hashes. Delete your account and data at any time." />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
          <SectionTitle eyebrow="FAQ" title="Questions people ask" />
          <div className="mt-10 divide-y divide-white/5 rounded-2xl border border-white/10">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ivory">
                  {f.q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="glass-panel flex flex-col items-center gap-5 px-6 py-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-3xl">Start on a demo account today</h2>
            <p className="max-w-xl text-muted-foreground">Practise with your broker&apos;s demo money until a strategy proves itself. Free while in beta.</p>
            <Button size="lg" asChild>
              <Link href="/signup">
                Create a free account <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function SectionTitle({ eyebrow, title, align = "center" }: { eyebrow: string; title: string; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : undefined}>
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-profit">{eyebrow}</div>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-ivory sm:text-3xl">{title}</h2>
    </div>
  );
}

function SecurityItem({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="p-1">
      <Icon className="h-5 w-5 text-gold" />
      <h3 className="mt-3 font-semibold text-ivory">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** How an order flows through binaryTrades — a diagram of the real architecture, not a screenshot. */
function FlowDiagram() {
  const box = "rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm";
  return (
    <div className="glass-panel p-5 sm:p-6" aria-label="How a trade flows through binaryTrades">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">Every order follows the same path</div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {["Strategy bots", "Your scripts", "TradingView alerts", "Manual buy / sell"].map((s) => (
          <div key={s} className={box}>
            {s}
          </div>
        ))}
      </div>
      <Arrow />
      <div className="rounded-xl border border-profit/40 bg-profit/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-profit">
          <ShieldCheck className="h-4 w-4" /> Risk Guard
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>· Risk per trade</span>
          <span>· Daily loss limit</span>
          <span>· Drawdown kill switch</span>
          <span>· Open-trade caps</span>
        </div>
      </div>
      <Arrow />
      <div className="grid grid-cols-2 gap-2">
        <div className={box}>
          <div className="font-medium text-ivory">Deriv</div>
          <div className="text-xs text-muted-foreground">Official API · stop &amp; target set</div>
        </div>
        <div className={box}>
          <div className="font-medium text-ivory">MetaTrader 5</div>
          <div className="text-xs text-muted-foreground">Exness &amp; any MT5 broker</div>
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Real or demo money is decided by the broker account you connect.</p>
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden className="flex justify-center py-2 text-muted-foreground">
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path d="M8 0v17M2 12l6 6 6-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
