-- 0008: bots can risk a fixed amount per trade (e.g. $25) instead of a % of the account.
-- Idempotent: safe to run more than once.

alter table bots add column if not exists risk_amount numeric;
