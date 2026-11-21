-- 0010: each user's Markets page: watchlist, indicators, drawings and price alerts.
-- One row per user (id = the user's id). Idempotent: safe to run more than once.

create table if not exists markets_state (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  watchlist jsonb,
  indicators jsonb,
  drawings jsonb,
  alerts jsonb,
  updated_at timestamptz not null default now()
);

alter table markets_state enable row level security;
