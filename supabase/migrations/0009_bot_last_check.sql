-- 0009: bots remember the engine's latest verdict ("waiting for next bar", "rejected: …"),
-- so a running bot that isn't trading shows why. Idempotent: safe to run more than once.

alter table bots add column if not exists last_check jsonb;
