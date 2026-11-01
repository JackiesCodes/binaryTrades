-- 0006: bots can read candles from their own MT5 broker (via the bridge EA)
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
