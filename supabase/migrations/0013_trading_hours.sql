-- 0013: bots can be limited to trading hours (when they may open new trades).
-- Idempotent: safe to run more than once.

alter table bots add column if not exists trading_hours jsonb;
