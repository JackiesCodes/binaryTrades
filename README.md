# binaryTrades — Auto-Trading Control Room

One dashboard to run, watch and risk-manage trading bots on **Exness
(MetaTrader 5)**, **Deriv** and **TradingView**.

Live at **https://binarytrades.vercel.app** (Vercel project `binarytrades`,
deployed from `main` of `JackiesCodes/binaryTrades`). Use that address for the
MT5 bridge Server URL, TradingView webhooks and the cron scheduler.

- **Bots**: built-in strategy bots that trade on their own, or TradingView
  bots that execute your Pine Script alerts. Start, pause, edit, buy/sell/close
  manually. Each bot trades on one connected broker account.
- **Brokers**: Exness (and any MT5 broker) through a small bridge EA you run
  in MetaTrader 5; Deriv through its official API (Multiplier contracts).
- **Scripts**: write or paste your own strategy in JavaScript, test it on real
  price history, and turn it into a bot (optionally started right away).
  Scripts run in an isolated QuickJS (WebAssembly) sandbox with no network,
  file or key access, a 3-second time limit and a 64 MB memory cap.
- **Accounts**: anyone can sign up with email and password. Each account's
  brokers, bots, scripts, trades and Risk Guard are completely separate.
  Includes email confirmation and password reset (via Resend), sign-out of
  other devices, account deletion, and an **Admin** page for administrators.
- **Public website**: landing page, Terms of Use, Privacy Policy and Risk
  Disclosure (`/legal/*`). Have a lawyer review the legal pages for your
  jurisdiction before launch.
- **Strategy Lab**: backtests on real Deriv price history, plus an optimiser
  that tunes every strategy on 70% of the data and ranks them on the 30% it
  has never seen. Turn the winner into a bot in one click.
- **Real or demo money is decided by the broker account**: connect a demo
  account at Exness or Deriv to practise with your broker's demo money, or a
  real account to trade real money. binaryTrades never simulates trades itself.
- **Risk Guard**: every order passes risk sizing (risk % per trade), a daily
  loss limit, a max-drawdown kill switch and open-trade caps before it can
  reach a broker. There is also a manual **kill switch** that pauses all bots
  and closes all positions.

> **About returns.** No strategy can guarantee profit, let alone 100% ROI,
> and anything that promises it is a red flag. The Strategy Lab exists so you
> can see how a strategy *would have* behaved, on data it wasn't tuned on,
> before risking money. Run it on a demo account first, then move it to a
> real account with small risk.

## How it works

```
TradingView alert ──► /api/webhooks/tradingview ─┐
Built-in strategy (each new candle) ─────────────┼─► engine: dedupe → Risk Guard → size → route
Manual button on the dashboard ──────────────────┘                                   │
                                                     ┌───────────────────────────────┤
                                                     ▼                               ▼
                                              Deriv API (Multiplier          MT5 command queue ──► BinaryTradesBridge EA
                                              contracts, SL/TP)              (/api/mt5/sync)       in your terminal
```

- The **engine tick** (`/api/engine/tick`, or `/api/cron/tick` for a
  scheduler) syncs Deriv accounts, runs built-in bots on each newly closed
  candle, and enforces the daily-loss and drawdown limits — separately for
  real and demo accounts, so a demo loss never pauses real-money bots. A
  drawdown on real accounts fires the kill switch; on demo accounts it pauses
  the demo bots. The open dashboard calls it
  every minute. For 24/7 trading, point a scheduler at the cron endpoint
  (see below).
- The **MT5 bridge EA** (`public/downloads/BinaryTradesBridge.mq5`) calls
  `/api/mt5/sync` every few seconds. It sends account info, open positions and
  closing deals, and receives queued orders, which it sizes from the risk
  amount and stop distance using the symbol's tick value. Positions opened by
  your other EAs or by hand appear too (marked "Other EA / manual"), and the
  kill switch closes them.
- Built-in bots get their candles from Deriv's free market data (e.g.
  `frxEURUSD` for Exness `EURUSDm`). Exness prices differ by a little spread,
  which matters little on H1 and above.

## Getting started (your PC or a VPS)

```bash
npm install
cp .env.example .env.local   # set APP_PASSWORD, CREDENTIALS_ENCRYPTION_KEY, CRON_SECRET
npm run build && npm start   # http://localhost:3000
```

With the Supabase variables empty, data is stored in `.data/binarytrades.json`.
That's ideal on a Windows VPS that also runs your MT5 terminal: one machine,
always on.

### Hosting on Vercel + Supabase

1. Add Supabase from the Vercel Marketplace (Storage → Supabase). This sets
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
   `POSTGRES_URL_NON_POOLING`. With `POSTGRES_URL_NON_POOLING` set, the app
   creates and updates its tables on start-up. Otherwise, run
   the files in `supabase/migrations/`, in order, in the Supabase SQL editor.
2. Set `APP_PASSWORD`, `CREDENTIALS_ENCRYPTION_KEY` and `CRON_SECRET` in Vercel.
3. Run the bots 24/7 with a free scheduler such as cron-job.org, calling
   `https://<your-app>/api/cron/tick?key=<CRON_SECRET>` every minute.

## Script bots

Open **Scripts**, start from an example or paste your own code, and define
`onBar(i)`. It runs once for every closed candle and returns `"buy"`,
`"sell"`, `"close"`, or nothing to keep the current position:

```js
const fast = ema(close, input("fast", 20)); // input() = a setting you can change per bot
const slow = ema(close, input("slow", 50));

function onBar(i) {
  if (crossover(fast, slow, i)) return "buy";
  if (crossunder(fast, slow, i)) return "sell";
}
```

Return `{ action: "buy", stop, target }` to set the trade's own stop-loss and
take-profit prices. Scripts also see `position` (their own side, entry and
bars held), `account` (balance, equity, demo or real), and, live,
`brokerPosition`. Define `onAlert(alert, i)` to handle TradingView alerts sent
to the bot: every field of the alert JSON arrives in `alert`, and the return
value works like `onBar`'s. A script may have `onBar`, `onAlert` or both.

On MT5 accounts, bots can use **MT5 broker prices**: the bridge EA (v2) sends
the broker's own closed candles for the bot's symbol, so signals and stops
match the prices you trade at.

Helpers: `open high low close time hl2 hlc3 bars`, `sma ema rma rsi
highest lowest stdev change (src, n)`, `atr(n)`, `bollinger`, `macd`,
`crossover / crossunder (a, b, i)` and `console.log`. Only read values up to
index `i`. Every trade gets a stop of ATR(14) × the bot's stop setting and is
sized by Risk Guard. If a running script throws an error, its bot pauses and
the error appears on the bot card. TradingView Pine Script can't run here; use
a TradingView alerts bot for it.

## Accounts and administrators

- Sign-up is open at `/signup`. Set `SIGNUPS_DISABLED=1` to pause it.
- Emails listed in `ADMIN_EMAILS` become administrators when they sign up.
  Administrators can also promote others from the **Admin** page.
- Everything created by the original single-owner version belongs to the
  account `owner` (an administrator). Its owner signs in with their password
  only ("Original account owner…" on the sign-in page) until they add an email
  on the **Account** page; after that they sign in with email and password.
- Email confirmation and password reset need `RESEND_API_KEY` and
  `EMAIL_FROM` on a domain you verified in Resend. Without them, new accounts
  are trusted without confirmation and "Forgot password" is unavailable.
- Bots run for every account from one engine tick every minute. On Supabase
  this is automatic: on start-up the production deployment registers a
  pg_cron job (`binarytrades-engine-tick`) that calls `/api/cron/tick` through
  pg_net, using `CRON_SECRET` and `APP_URL`. Check it at
  `/api/cron/health?key=CRON_SECRET` (`engine_schedule`). Set
  `ENGINE_SCHEDULER=0` to turn it off, or use any external scheduler instead.

## Connecting your accounts

Start with **demo** accounts. Every bot is created paused, on the account you
choose; whether it trades real or demo money depends only on that account.

### Exness (MetaTrader 5)

1. **Brokers → Exness → Generate bridge key**. Copy the Server URL and the key
   (the key is shown once).
2. Download the EA (**Download EA** button), put it in MT5's
   `MQL5/Experts` folder (*File → Open Data Folder*) and compile it.
3. In MT5, go to *Tools → Options → Expert Advisors*: allow algorithmic
   trading and *Allow WebRequest for listed URL*, then add your Server URL.
4. Attach **BinaryTradesBridge** to one chart, paste the URL and key, and turn on
   **Algo Trading**. The account shows **Connected** within seconds.
5. When creating a bot, use the symbol exactly as Market Watch shows it
   (e.g. `EURUSDm`, `XAUUSDm`).

Your MT5 terminal must stay running for bots to trade: use a VPS for 24/7.

### Deriv

binaryTrades uses Deriv's current API (`api.derivws.com`). The legacy
`ws.derivws.com` WebSocket no longer accepts connections from cloud hosts.

1. Sign in at developers.deriv.com with your Deriv login and register an app;
   copy its **App ID**.
2. Create a **Personal Access Token** with the **trade** scope only (never
   payment).
3. Go to **Brokers → Deriv**, enter the App ID and token, and click
   **Connect**. Every active Deriv Options account the token can reach (demo
   and real) is connected separately, and real or demo money follows that
   account. The token is encrypted at rest (AES-256-GCM).
4. Deriv bots trade Multiplier contracts. Stake is sized so that hitting the
   stop loses about your risk amount, and is never more than 25% of equity.
   Pick a multiplier Deriv allows for that market.

You can also trade Deriv through its MT5 accounts using the Exness steps above.

### TradingView

1. Create a **TradingView alerts** bot.
2. On the bot card, click **TradingView setup**, then copy the webhook URL and
   the alert message into your TradingView alert. Webhooks require a paid
   TradingView plan.
3. The alert action can be `buy` / `sell` / `close` (or
   `{{strategy.order.action}}`), optionally with `"sl"` and `"tp"` prices.
   Duplicate alerts (same `id`) are ignored, and opposite signals reverse the
   position.

## Before trading real money: checklist

- [ ] The strategy ran on a demo account for 2–4 weeks, and the results
      resemble its Strategy Lab "unseen-data" numbers.
- [ ] Risk per trade is 0.5–1%, and the daily loss limit and max drawdown are
      set in Risk Guard.
- [ ] You tested the kill switch on a demo account.
- [ ] The MT5 terminal or VPS and the scheduler stay up when you're away.

Note: deposits and withdrawals change equity just like profit and loss. A
large withdrawal can look like a drawdown and trigger the kill switch, so
pause bots before moving money.

## Security

- The dashboard needs `APP_PASSWORD` in production (HMAC-signed, httpOnly
  session cookie). Machine endpoints authenticate separately:
  - TradingView: a per-bot passphrase, compared in constant time.
  - MT5 bridge: a per-account key; only its SHA-256 hash is stored.
  - Cron: `CRON_SECRET`.
- Broker tokens are encrypted with `CREDENTIALS_ENCRYPTION_KEY` and never
  leave the server. Supabase tables have RLS enabled with no policies, so
  only the server's service-role key can read them.
- Passwords you set are stored as salted scrypt hashes. Session cookies carry
  a version number, so a password change or "sign out other devices" ends
  older sessions within about 10 seconds.
- Per-trade risk is hard-capped at 5%, and MT5 orders are capped by the EA's
  `InpMaxLots` input.

## Project structure

```
src/
  app/
    dashboard/            # Overview, Bots, Brokers, Trades, Strategy Lab, Risk Guard, Logs
    login/
    api/
      webhooks/tradingview  mt5/sync  cron/tick  engine/tick
      bots  brokers  trades  settings  kill-switch  strategy-lab  scripts  profile  state  auth
  components/app/         # shell, live state provider, widgets
  lib/
    trading/              # engine, risk, store (Supabase or JSON file), types, symbols
    brokers/              # deriv.ts (WebSocket API), mt5.ts (bridge protocol)
    strategies/           # indicators, strategies, script sandbox, backtester + walk-forward optimiser
    auth/                 # session cookies, password hashing, profile
public/downloads/BinaryTradesBridge.mq5   # MetaTrader 5 bridge EA
supabase/migrations/      # Postgres schema
tests/                    # vitest: strategies, risk, engine, MT5 bridge
```

```bash
npm test            # unit tests
npm run typecheck
npm run lint
```
