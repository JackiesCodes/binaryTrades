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
import { DashboardPreview } from "@/components/site/dashboard-preview";
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

const TRUST = [
  { label: "Works with", value: "Deriv · MT5 · Exness · TradingView" },
  { label: "Before every order", value: "Risk Guard checks" },
  { label: "Broker access", value: "Trade-only" },
  { label: "Price", value: "Free in beta" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-3 sm:px-5">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[26px] bg-panel">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-engraving opacity-50 [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_65%)]" />
          <div className="relative grid items-center gap-10 px-5 py-12 sm:px-10 lg:grid-cols-[1fr_1.15fr] lg:gap-12 lg:py-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-profit/10 px-3 py-1 text-xs font-medium text-profit">
                <Sparkles className="h-3.5 w-3.5" /> Free during beta
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-ivory sm:text-5xl">
                Automate your trading.
                <br />
                <span className="text-profit">Keep control of the risk.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Connect your Deriv and MetaTrader 5 accounts, run strategy bots or your own scripts, execute TradingView alerts — and let Risk Guard
                enforce your limits around the clock, from one dashboard.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild className="h-12 rounded-xl px-6 text-[15px] font-bold">
                  <Link href="/signup">
                    Create a free account <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="h-12 rounded-xl border-white/10 bg-black/20 px-6">
                  <Link href="/#how-it-works">See how it works</Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">No card required · Start on a demo account · Your funds stay with your broker</p>
            </div>
            <DashboardPreview />
          </div>
        </section>

        {/* Key facts, like the dashboard's header strip */}
        <section className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4 rounded-[18px] bg-panel px-5 py-4 md:flex md:items-center md:gap-8">
          <div className="col-span-2 flex items-center gap-3 md:col-span-1 md:border-r md:border-white/[0.06] md:pr-8">
            <Tile icon={ShieldCheck} />
            <div>
              <div className="font-bold text-ivory">Software, not a broker</div>
              <div className="text-xs text-muted-foreground">Your money stays with your broker</div>
            </div>
          </div>
          {TRUST.map((t) => (
            <div key={t.label} className="min-w-0">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="truncate text-sm font-medium text-ivory">{t.value}</div>
            </div>
          ))}
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-24 pt-20">
          <SectionTitle eyebrow="Features" title="Everything between your idea and your broker" />
          <div className="mt-10 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon, title, body }) => (
              <article key={title} className="rounded-[18px] bg-panel p-5">
                <Tile icon={icon} />
                <h3 className="mt-4 font-bold text-ivory">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Strategy Lab */}
        <section className="pt-20">
          <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="rounded-[18px] bg-panel p-6 sm:p-8">
              <SectionTitle eyebrow="Strategy Lab" title="Tested on data it has never seen" align="left" />
              <p className="mt-4 text-muted-foreground">
                Tuning a strategy on past prices always looks good. The Strategy Lab tunes every strategy on the first 70% of the history and ranks
                them only on the 30% they never saw — with trading costs included — so you see results closer to what live trading looks like.
              </p>
              <div className="mt-6 flex h-10 overflow-hidden rounded-xl bg-black/30 p-1 text-xs font-medium">
                <div className="flex w-[70%] items-center justify-center rounded-lg text-muted-foreground">Tuning data · 70%</div>
                <div className="flex w-[30%] items-center justify-center rounded-lg bg-profit font-semibold text-ink">Unseen · 30%</div>
              </div>
              <ul className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                <li className="flex gap-2">
                  <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Real Deriv price history: forex, gold, crypto, synthetics
                </li>
                <li className="flex gap-2">
                  <CandlestickChart className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Return, drawdown, win rate, profit factor and every trade
                </li>
                <li className="flex gap-2">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-profit" /> Turn a result into a demo bot in one click
                </li>
              </ul>
            </div>
            <LeaderboardExample />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24 pt-20">
          <SectionTitle eyebrow="How it works" title="From sign-up to your first bot in minutes" />
          <ol className="mt-10 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-[18px] bg-panel p-5">
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-sm font-semibold ${i === 0 ? "bg-profit text-ink" : "bg-white/[0.06] text-profit"}`}>
                    {i + 1}
                  </span>
                  <span className="h-px flex-1 bg-white/[0.08]" aria-hidden />
                </div>
                <h3 className="mt-4 font-bold text-ivory">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="rounded-[18px] bg-panel p-6 sm:p-8">
              <h3 className="text-lg font-bold text-ivory">Every order takes the same path</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Whether a strategy, your script, a TradingView alert or your own tap sends it, an order goes through Risk Guard before it reaches your
                broker. Real or demo money is decided by the broker account you connect.
              </p>
              <Button asChild className="mt-6 h-11 rounded-xl px-5 font-bold">
                <Link href="/signup">
                  Start on a demo account <ArrowRight />
                </Link>
              </Button>
            </div>
            <FlowDiagram />
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-24 pt-20">
          <SectionTitle eyebrow="Security" title="Built so that a mistake can't empty your account" />
          <div className="mt-10 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <SecurityItem icon={KeyRound} title="Trade-only access" body="Deriv tokens need only the trade scope. Nothing here can withdraw or transfer money." />
            <SecurityItem icon={Lock} title="Encrypted keys" body="Broker tokens are encrypted with AES-256-GCM and never leave the server. MT5 bridge keys are stored as hashes." />
            <SecurityItem icon={Code2} title="Sandboxed scripts" body="Scripts run in an isolated engine with no internet, file or key access, and strict time and memory limits." />
            <SecurityItem icon={ShieldCheck} title="Your account, your data" body="Each account is fully separated. Passwords are salted hashes. Delete your account and data at any time." />
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 pt-20">
          <div className="grid items-start gap-3.5 lg:grid-cols-[380px_minmax(0,1fr)]">
            <div className="rounded-[18px] bg-panel p-6 sm:p-8 lg:sticky lg:top-24">
              <SectionTitle eyebrow="FAQ" title="Questions people ask" align="left" />
              <p className="mt-3 text-sm text-muted-foreground">Straight answers about money, risk and access. Read the Risk Disclosure before trading.</p>
              <Button variant="outline" asChild className="mt-5 rounded-xl border-white/10 bg-black/20">
                <Link href="/legal/risk">Risk Disclosure</Link>
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {FAQ.map((f) => (
                <details key={f.q} className="group rounded-[18px] bg-panel px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ivory">
                    {f.q}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-transform group-open:rotate-45 group-open:bg-profit group-open:text-ink">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="relative overflow-hidden rounded-[26px] bg-panel px-6 py-12 text-center sm:py-14">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-engraving opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]" />
            <div className="relative flex flex-col items-center gap-5">
              <h2 className="text-2xl font-bold tracking-tight text-ivory sm:text-3xl">Start on a demo account today</h2>
              <p className="max-w-xl text-muted-foreground">Practise with your broker&apos;s demo money until a strategy proves itself. Free while in beta.</p>
              <Button size="lg" asChild className="h-12 rounded-xl px-6 text-[15px] font-bold">
                <Link href="/signup">
                  Create a free account <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Tile({ icon: Icon }: { icon: typeof Lock }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-profit">
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** A leaderboard card like the Strategy Lab's, with clearly made-up example numbers. */
function LeaderboardExample() {
  const rows: Array<[string, string, string, string]> = [
    ["EMA Trend Rider", "+6.2%", "4.1%", "54%"],
    ["Channel breakout", "+3.8%", "5.6%", "47%"],
    ["RSI reversal", "−1.4%", "7.9%", "51%"],
  ];
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-panel p-4">
      <div className="flex items-center justify-between">
        <span className="font-bold text-ivory">Leaderboard</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-muted-foreground">Example</span>
      </div>
      {rows.map(([name, ret, dd, win], i) => (
        <div key={name} className={`rounded-[14px] bg-black/25 p-3 ring-1 ${i === 0 ? "ring-profit/50" : "ring-transparent"}`}>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-muted-foreground">#{i + 1}</span>
            <span className="font-bold text-ivory">{name}</span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            {[
              ["Unseen data", ret, ret.startsWith("+") ? "text-profit" : "text-loss"],
              ["Max DD", dd, ""],
              ["Win rate", win, ""],
            ].map(([k, v, tone]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={`font-mono text-sm text-ivory ${tone}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">Illustration of the layout, not real results.</p>
    </div>
  );
}

function SectionTitle({ eyebrow, title, align = "center" }: { eyebrow: string; title: string; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : undefined}>
      <div className="inline-flex rounded-full bg-profit/10 px-3 py-1 text-xs font-semibold text-profit">{eyebrow}</div>
      <h2 className="mt-3 text-2xl font-bold tracking-tight text-ivory sm:text-3xl text-balance">{title}</h2>
    </div>
  );
}

function SecurityItem({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="rounded-[18px] bg-panel p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] text-gold">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-bold text-ivory">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/** How an order flows through binaryTrades — a diagram of the real architecture, not a screenshot. */
function FlowDiagram() {
  const box = "rounded-xl bg-black/25 px-3 py-2 text-sm";
  return (
    <div className="rounded-[18px] bg-panel p-4" aria-label="How a trade flows through binaryTrades">
      <div className="text-xs text-muted-foreground">Order path</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {["Strategy bots", "Your scripts", "TradingView alerts", "Manual buy / sell"].map((s) => (
          <div key={s} className={box}>
            {s}
          </div>
        ))}
      </div>
      <Arrow />
      <div className="rounded-xl bg-profit/10 p-4 ring-1 ring-profit/40">
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
