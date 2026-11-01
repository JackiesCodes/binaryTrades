import type { Metadata } from "next";
import Link from "next/link";

import { Contact, LEGAL_UPDATED } from "@/components/site/legal";

export const metadata: Metadata = { title: "Terms of Use — binaryTrades" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p>Last updated {LEGAL_UPDATED}</p>
      <p>
        These terms apply to your use of binaryTrades (the &ldquo;Service&rdquo;). By creating an account you agree to them. If you don&apos;t
        agree, don&apos;t use the Service.
      </p>

      <h2>1. What the Service is</h2>
      <p>
        binaryTrades is software that lets you connect broker accounts you already hold (such as Deriv or a MetaTrader 5 account), run automated
        strategies and scripts, receive TradingView alerts, and apply risk limits. <strong>binaryTrades is not a broker, bank, investment firm or
        financial adviser.</strong> It does not hold, receive or transfer your money, and it does not give investment, legal or tax advice. Built-in
        strategies, templates and backtests are tools, not recommendations.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and legally allowed to trade the products you trade in your country.</li>
        <li>Give accurate details and keep your password secret. You are responsible for everything done through your account.</li>
        <li>One person per account. Don&apos;t share access or create accounts for others without their consent.</li>
      </ul>

      <h2>3. Broker connections and orders</h2>
      <ul>
        <li>
          You authorise the Service to place, modify and close orders on the broker accounts you connect, according to the bots, scripts, alerts
          and settings you configure. Whether money is real or demo depends on the broker account you connect.
        </li>
        <li>Use credentials with the least access needed (for Deriv, a token with the trade scope only). Never give us withdrawal or payment access.</li>
        <li>
          Your broker&apos;s own terms, fees, spreads, margin rules and order handling apply. Orders can be rejected, delayed, slipped or filled at a
          different price. Market data can be wrong or late.
        </li>
        <li>
          Automated systems depend on internet connections, your broker&apos;s systems, TradingView, our hosting and, for MetaTrader 5, your own
          terminal staying online. Any of them can fail. Monitor your positions and keep your own stop-losses in place.
        </li>
      </ul>

      <h2>4. Scripts and content you provide</h2>
      <p>
        You own the scripts and settings you create. You give us permission to store and run them only to provide the Service to you. Don&apos;t
        upload anything unlawful, malicious, or that tries to break, overload or escape the script sandbox.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Don&apos;t misuse the Service: no attacks on its security, no scraping or overloading it, no use for market manipulation or to break your
        broker&apos;s rules or the law, and no reselling access. We may limit, suspend or close accounts that do, or that put other users at risk.
      </p>

      <h2>6. Risk and no guarantee</h2>
      <p>
        Trading is high-risk and you can lose all the money in your account. Past or backtested performance does not guarantee future results.
        You are solely responsible for your trading decisions and their outcome. Please read the{" "}
        <Link href="/legal/risk" className="text-profit underline">
          Risk Disclosure
        </Link>
        .
      </p>

      <h2>7. The Service is provided &ldquo;as is&rdquo;</h2>
      <p>
        The Service is in beta and is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, including that it
        will be uninterrupted, error-free or profitable. Features may change or be withdrawn.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the extent the law allows, binaryTrades and its operators are not liable for trading losses, lost profits, missed trades, or indirect
        or consequential losses arising from your use of the Service, outages, errors, third-party services (brokers, TradingView, hosting) or
        market events. Nothing in these terms limits liability that cannot be limited by law.
      </p>

      <h2>9. Fees</h2>
      <p>The Service is free during the beta. If we introduce paid plans, we&apos;ll tell you in advance and you can choose whether to continue.</p>

      <h2>10. Ending your account</h2>
      <p>
        You can delete your account at any time from the Account page. We may suspend or close accounts that break these terms. When an account
        ends, bots stop; positions remain with your broker.
      </p>

      <h2>11. Changes</h2>
      <p>We may update these terms. For significant changes we&apos;ll notify you in the app. Continuing to use the Service means you accept the new terms.</p>

      <h2>12. Contact</h2>
      <p>
        Questions about these terms: <Contact />.
      </p>
    </>
  );
}
