// Database schema, applied in order. Each entry mirrors a file in
// supabase/migrations/ (a test keeps them identical). The app applies them
// itself on start-up (ensureSchema in store.ts) when POSTGRES_URL_NON_POOLING
// (or DATABASE_URL) is set, so no manual SQL step is needed.

export const MIGRATIONS = [
  {
    file: "0001_amogana_autotrade.sql",
    sql: `-- Amogana auto-trading schema.
--
-- Only the server talks to these tables, using the service-role key
-- (src/lib/trading/store.ts). RLS is enabled with no policies so the anon
-- key and browser clients can read or write nothing.

create table if not exists settings (
  id text primary key default 'global',
  kill_switch boolean not null default false,
  daily_loss_limit numeric not null default 250,
  max_drawdown_percent numeric not null default 15,
  max_open_trades integer not null default 8,
  max_trades_per_bot integer not null default 1,
  default_risk_percent numeric not null default 1,
  paper_starting_balance numeric not null default 10000,
  books jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists brokers (
  id text primary key,
  kind text not null check (kind in ('deriv', 'mt5')),
  label text not null,
  status text not null check (status in ('connected', 'waiting', 'error')),
  login text,
  server text,
  currency text not null default 'USD',
  balance numeric not null default 0,
  equity numeric not null default 0,
  is_demo boolean not null default false,
  encrypted_token text,
  bridge_key_hash text unique,
  last_sync_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists bots (
  id text primary key,
  name text not null,
  source text not null check (source in ('builtin', 'tradingview')),
  broker_account_id text references brokers (id) on delete set null,
  book text not null check (book in ('paper', 'live')),
  symbol text not null,
  data_symbol text not null,
  timeframe integer not null,
  strategy jsonb,
  status text not null check (status in ('running', 'paused')),
  paused_reason text,
  risk_percent numeric not null,
  deriv_multiplier integer not null default 100,
  magic integer not null,
  webhook_passphrase text not null,
  last_bar_epoch bigint,
  last_signal_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists trades (
  id text primary key,
  bot_id text references bots (id) on delete set null,
  broker_account_id text references brokers (id) on delete set null,
  book text not null check (book in ('paper', 'live')),
  symbol text not null,
  data_symbol text,
  side text not null check (side in ('buy', 'sell')),
  size numeric not null,
  size_unit text not null check (size_unit in ('lots', 'stake', 'units')),
  entry_price numeric,
  current_price numeric,
  sl numeric,
  tp numeric,
  risk_amount numeric not null default 0,
  pnl numeric not null default 0,
  status text not null check (status in ('pending', 'open', 'closed', 'rejected')),
  broker_ref text,
  magic integer,
  external boolean not null default false,
  close_reason text,
  exit_price numeric,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists trades_status_idx on trades (status);
create index if not exists trades_bot_idx on trades (bot_id);
create index if not exists trades_broker_idx on trades (broker_account_id, status);

create table if not exists signals (
  id text primary key,
  bot_id text references bots (id) on delete set null,
  source text not null,
  action text not null,
  symbol text,
  price numeric,
  sl numeric,
  tp numeric,
  external_id text,
  status text not null,
  reason text,
  received_at timestamptz not null default now()
);
create index if not exists signals_dedup_idx on signals (bot_id, external_id);
create index if not exists signals_received_idx on signals (received_at desc);

create table if not exists commands (
  id text primary key,
  account_id text not null references brokers (id) on delete cascade,
  trade_id text references trades (id) on delete set null,
  type text not null check (type in ('open', 'close', 'close_all')),
  payload jsonb not null default '{}',
  status text not null check (status in ('queued', 'sent', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists commands_queue_idx on commands (account_id, status);

create table if not exists logs (
  id text primary key,
  level text not null,
  message text not null,
  bot_id text references bots (id) on delete set null,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists logs_created_idx on logs (created_at desc);

create table if not exists equity (
  id text primary key,
  book text not null check (book in ('paper', 'live')),
  equity numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists equity_book_idx on equity (book, created_at);

alter table settings enable row level security;
alter table brokers enable row level security;
alter table bots enable row level security;
alter table trades enable row level security;
alter table signals enable row level security;
alter table commands enable row level security;
alter table logs enable row level security;
alter table equity enable row level security;
`,
  },
  {
    file: "0002_account_based_books.sql",
    sql: `-- 0002: real vs demo money now comes from the broker account; paper mode is removed.
-- Idempotent: safe to run more than once.

alter table bots drop column if exists book;
alter table settings drop column if exists paper_starting_balance;

-- Paper trades and equity points were simulated; drop them.
alter table trades drop constraint if exists trades_book_check;
alter table trades drop constraint if exists trades_size_unit_check;
delete from trades where book = 'paper' or size_unit = 'units';
update trades t set book = case when b.is_demo then 'demo' else 'real' end
  from brokers b where t.broker_account_id = b.id and t.book not in ('real', 'demo');
update trades set book = 'real' where book not in ('real', 'demo');
alter table trades add constraint trades_book_check check (book in ('real', 'demo'));
alter table trades add constraint trades_size_unit_check check (size_unit in ('lots', 'stake'));

alter table equity drop constraint if exists equity_book_check;
delete from equity where book not in ('real', 'demo');
alter table equity add constraint equity_book_check check (book in ('real', 'demo'));

-- Risk baselines restart from current equity on the next engine run.
update settings
  set books = '{"real":{"peak_equity":0,"day_key":"","day_start_equity":0},"demo":{"peak_equity":0,"day_key":"","day_start_equity":0}}'::jsonb
  where not (books ? 'real' and books ? 'demo');
`,
  },
  {
    file: "0003_deriv_app_id.sql",
    sql: `-- 0003: Deriv's current API authenticates with a Personal Access Token plus the
-- App ID of the user's registered Deriv app; store the App ID per account.
-- Idempotent: safe to run more than once.

alter table brokers add column if not exists app_id text;
`,
  },
  {
    file: "0004_owner_profile.sql",
    sql: `-- 0004: the owner's profile and sign-in password. Until a password is set here,
-- APP_PASSWORD signs in. session_version goes up on every password change or
-- "sign out other devices", which invalidates every older session cookie.
-- Idempotent: safe to run more than once.

create table if not exists profile (
  id text primary key default 'owner',
  display_name text,
  email text,
  password_hash text,
  password_changed_at timestamptz,
  session_version integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table profile enable row level security;
`,
  },
  {
    file: "0005_multi_user.sql",
    sql: `-- 0005: multi-user accounts. Every broker account, bot, trade, signal, log line,
-- equity point and Risk Guard setting now belongs to one user. Everything that
-- existed before belongs to the original owner (user id 'owner', an admin).
-- Idempotent: safe to run more than once.

create table if not exists users (
  id text primary key,
  -- Lower-case. Null only for the original owner until they add an email.
  email text unique,
  display_name text,
  password_hash text,
  role text not null default 'user' check (role in ('user', 'admin')),
  email_verified_at timestamptz,
  session_version integer not null default 1,
  disabled boolean not null default false,
  accepted_terms_at timestamptz,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-time links for email verification and password reset. Only a hash of the token is stored.
create table if not exists auth_tokens (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('verify_email', 'reset_password')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_tokens_user_idx on auth_tokens (user_id, kind);

-- The original owner, carrying over their profile (name, password, sessions).
insert into users (id, display_name, email, password_hash, role, session_version, password_changed_at)
  select 'owner', p.display_name, lower(p.email), p.password_hash, 'admin', p.session_version, p.password_changed_at
  from profile p where p.id = 'owner'
  on conflict (id) do nothing;
insert into users (id, role) values ('owner', 'admin') on conflict (id) do nothing;

alter table brokers add column if not exists user_id text references users (id) on delete cascade;
alter table bots add column if not exists user_id text references users (id) on delete cascade;
alter table trades add column if not exists user_id text references users (id) on delete cascade;
alter table signals add column if not exists user_id text references users (id) on delete cascade;
alter table logs add column if not exists user_id text references users (id) on delete cascade;
alter table equity add column if not exists user_id text references users (id) on delete cascade;

update brokers set user_id = 'owner' where user_id is null;
update bots set user_id = 'owner' where user_id is null;
update trades set user_id = 'owner' where user_id is null;
update signals set user_id = 'owner' where user_id is null;
update logs set user_id = 'owner' where user_id is null;
update equity set user_id = 'owner' where user_id is null;

alter table brokers alter column user_id set not null;
alter table bots alter column user_id set not null;
alter table trades alter column user_id set not null;
alter table signals alter column user_id set not null;
alter table equity alter column user_id set not null;
-- logs.user_id stays nullable for platform-wide messages.

create index if not exists brokers_user_idx on brokers (user_id);
create index if not exists bots_user_idx on bots (user_id);
create index if not exists trades_user_idx on trades (user_id, status);
create index if not exists signals_user_idx on signals (user_id, received_at desc);
create index if not exists logs_user_idx on logs (user_id, created_at desc);
create index if not exists equity_user_idx on equity (user_id, book, created_at);

-- Risk Guard settings: one row per user, keyed by the user id.
alter table settings alter column id drop default;
update settings set id = 'owner' where id = 'global';

alter table users enable row level security;
alter table auth_tokens enable row level security;
`,
  },
  {
    file: "0006_broker_prices.sql",
    sql: `-- 0006: bots can read candles from their own MT5 broker (via the bridge EA)
-- instead of Deriv's market data. Idempotent: safe to run more than once.

alter table bots add column if not exists price_source text not null default 'deriv';
alter table bots drop constraint if exists bots_price_source_check;
alter table bots add constraint bots_price_source_check check (price_source in ('deriv', 'broker'));

-- The bridge EA can be asked for candles.
alter table commands drop constraint if exists commands_type_check;
alter table commands add constraint commands_type_check check (type in ('open', 'close', 'close_all', 'candles'));

-- Latest closed candles per MT5 account, symbol and timeframe, as sent by the bridge EA.
create table if not exists market_data (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  account_id text not null references brokers (id) on delete cascade,
  symbol text not null,
  timeframe integer not null,
  -- [[epoch, open, high, low, close], ...] oldest first; epochs in broker server time
  bars jsonb not null default '[]',
  -- broker server time minus UTC, in seconds
  server_offset integer not null default 0,
  error text,
  requested_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists market_data_account_idx on market_data (account_id);

alter table market_data enable row level security;
`,
  },
] as const;

/** For each migration, a query returning `done = true` once its changes are in place. */
export const APPLIED_CHECKS: Record<(typeof MIGRATIONS)[number]["file"], string> = {
  "0001_amogana_autotrade.sql": "select to_regclass('public.equity') is not null as done",
  "0002_account_based_books.sql":
    "select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bots' and column_name = 'book') as done",
  "0003_deriv_app_id.sql":
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'brokers' and column_name = 'app_id') as done",
  "0004_owner_profile.sql": "select to_regclass('public.profile') is not null as done",
  "0005_multi_user.sql":
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'equity' and column_name = 'user_id') as done",
  "0006_broker_prices.sql": "select to_regclass('public.market_data') is not null as done",
};
