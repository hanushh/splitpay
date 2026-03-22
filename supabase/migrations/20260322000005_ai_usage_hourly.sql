-- Hourly per-user rate limiting for AI chat abuse prevention.
-- Tracks requests per hour per user; auto-cleaned after 48 hours.

create table if not exists public.ai_chat_usage_hourly (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  hour_bucket  timestamptz not null,
  count        integer     not null default 0,
  primary key  (user_id, hour_bucket)
);

alter table public.ai_chat_usage_hourly enable row level security;

create index if not exists ai_chat_usage_hourly_idx
  on public.ai_chat_usage_hourly (user_id, hour_bucket);

-- Atomically increment hourly usage and return new count.
-- Called by the ai-chat edge function (service role).
create or replace function public.increment_ai_usage_hourly(
  p_user_id uuid,
  p_hour    timestamptz
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.ai_chat_usage_hourly (user_id, hour_bucket, count)
  values (p_user_id, p_hour, 1)
  on conflict (user_id, hour_bucket)
  do update set count = ai_chat_usage_hourly.count + 1
  returning count into v_count;

  return v_count;
end;
$$;

-- Cleanup function: remove records older than 48 hours.
-- Called periodically via pg_cron or manually.
create or replace function public.cleanup_ai_usage_hourly()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_chat_usage_hourly
  where hour_bucket < now() - interval '48 hours';
end;
$$;

-- Per-minute window tracking (reuses same table structure as hourly,
-- distinguished by p_window label stored as part of the bucket key via a
-- separate table to avoid primary key conflicts).

create table if not exists public.ai_chat_usage_minute (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  minute_bucket timestamptz not null,
  count         integer     not null default 0,
  primary key   (user_id, minute_bucket)
);

alter table public.ai_chat_usage_minute enable row level security;

create index if not exists ai_chat_usage_minute_idx
  on public.ai_chat_usage_minute (user_id, minute_bucket);

-- Generic window increment: routes to minute or hourly table.
create or replace function public.increment_ai_usage_window(
  p_user_id uuid,
  p_bucket  timestamptz,
  p_window  text  -- 'minute' | 'hour'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_window = 'minute' then
    insert into public.ai_chat_usage_minute (user_id, minute_bucket, count)
    values (p_user_id, p_bucket, 1)
    on conflict (user_id, minute_bucket)
    do update set count = ai_chat_usage_minute.count + 1
    returning count into v_count;
  else
    insert into public.ai_chat_usage_hourly (user_id, hour_bucket, count)
    values (p_user_id, p_bucket, 1)
    on conflict (user_id, hour_bucket)
    do update set count = ai_chat_usage_hourly.count + 1
    returning count into v_count;
  end if;

  return v_count;
end;
$$;

-- Cleanup: remove minute records older than 2 hours, hourly older than 48 hours.
create or replace function public.cleanup_ai_usage_windows()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_chat_usage_minute
  where minute_bucket < now() - interval '2 hours';

  delete from public.ai_chat_usage_hourly
  where hour_bucket < now() - interval '48 hours';
end;
$$;
