-- Simplify AI rate limiting: remove hourly and minute tables.
-- Per-user daily (ai_chat_usage) + global daily (ai_global_usage) is sufficient.

drop function if exists public.increment_ai_usage_window(uuid, timestamptz, text);
drop function if exists public.increment_ai_usage_hourly(uuid, timestamptz);
drop function if exists public.cleanup_ai_usage_hourly();
drop function if exists public.cleanup_ai_usage_windows();

drop table if exists public.ai_chat_usage_minute;
drop table if exists public.ai_chat_usage_hourly;
