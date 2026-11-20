-- 0007: demo-only "double the account" challenges on bots.
-- Idempotent: safe to run more than once.

alter table bots add column if not exists challenge jsonb;
