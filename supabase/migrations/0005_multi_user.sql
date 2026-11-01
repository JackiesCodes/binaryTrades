-- 0005: multi-user accounts. Every broker account, bot, trade, signal, log line,
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
