-- 0004: the owner's profile and sign-in password. Until a password is set here,
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
