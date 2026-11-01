import type { Metadata } from "next";

import { Contact, LEGAL_UPDATED } from "@/components/site/legal";

export const metadata: Metadata = { title: "Privacy Policy — binaryTrades" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p>Last updated {LEGAL_UPDATED}</p>
      <p>This policy explains what binaryTrades collects, why, and the choices you have.</p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> your email address, optional display name, a salted hash of your password (never the password itself),
          and when you signed up and last signed in.
        </li>
        <li>
          <strong>Broker connections:</strong> for Deriv, your account IDs, balances and an encrypted API token; for MetaTrader 5, account number,
          server, balances and a hash of the bridge key. We never ask for your broker password.
        </li>
        <li>
          <strong>Trading activity:</strong> the bots, scripts and settings you create, the signals received, the orders placed and their results,
          equity history and activity logs.
        </li>
        <li>
          <strong>Technical data:</strong> IP addresses and request information processed by our hosting provider for security and to keep the
          Service running.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To provide the Service: run your bots, place your orders, show your dashboard and send account emails (confirmations and password resets).</li>
        <li>To keep the Service secure: rate limits, abuse prevention and investigating problems.</li>
        <li>We don&apos;t sell your data, and we don&apos;t use it for advertising.</li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        We use service providers to run binaryTrades: hosting (Vercel), a database (Supabase), and an email provider for account emails. Your
        orders and account requests go to the brokers you connect (such as Deriv or your MT5 broker), and TradingView sends us the alerts you
        configure. Each provider handles data under its own privacy terms.
      </p>

      <h2>Security</h2>
      <p>
        Broker tokens are encrypted with AES-256-GCM, MT5 bridge keys and passwords are stored only as hashes, connections use HTTPS, and every
        account&apos;s data is kept separate. No system is perfectly secure; please use a unique password and trade-only broker tokens.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account is open. When you delete your account, your broker connections, bots, scripts, trades and logs are
        deleted from our database; backups roll over within a limited period.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and change your details on the Account page and delete your account there at any time. Depending on where you live, you may
        also have rights to access, correct, export or object to the use of your data. To use them, contact <Contact />.
      </p>

      <h2>Changes</h2>
      <p>We&apos;ll post any changes here and update the date above. Significant changes will be announced in the app.</p>
    </>
  );
}
