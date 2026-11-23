-- 0012: daily summary notifications: each device's time zone, and the day it last got a summary.
-- Idempotent: safe to run more than once.

alter table push_devices add column if not exists timezone text;
alter table push_devices add column if not exists summary_sent_on text;
