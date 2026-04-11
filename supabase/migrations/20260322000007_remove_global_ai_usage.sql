-- Remove global daily AI usage tracking. Per-user daily limit is sufficient.
drop function if exists public.increment_ai_global_usage(date);
drop table if exists public.ai_global_usage;
