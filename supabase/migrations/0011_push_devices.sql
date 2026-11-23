-- 0011: devices (browsers, phones) that get push notifications for price alerts and trades.
-- Idempotent: safe to run more than once.

create table if not exists push_devices (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  topics jsonb not null default '{"alerts": true, "trades": true}',
  label text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);

create index if not exists push_devices_user on push_devices (user_id);

alter table push_devices enable row level security;
