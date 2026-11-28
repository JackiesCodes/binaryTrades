-- 0014: "Protect profits": bots can move their stop to break-even and trail it behind the best
-- price; trades remember their best price and that stop. Idempotent: safe to run more than once.

alter table bots add column if not exists trail jsonb;
alter table trades add column if not exists best_price numeric;
alter table trades add column if not exists trail_stop numeric;
