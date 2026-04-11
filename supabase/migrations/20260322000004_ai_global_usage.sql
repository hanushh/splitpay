-- Global daily Gemini API call counter for billing control.
-- Separate from per-user tracking — this is a single row per day
-- incremented on every successful Gemini call across all users.

create table if not exists public.ai_global_usage (
  usage_date  date    primary key default current_date,
  count       integer not null default 0
);

-- Only the service role (edge function) can read/write this table
alter table public.ai_global_usage enable row level security;
-- No user-facing RLS policies — access is service-role only

-- Atomically increment global usage and return new count.
create or replace function public.increment_ai_global_usage(
  p_date date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.ai_global_usage (usage_date, count)
  values (p_date, 1)
  on conflict (usage_date)
  do update set count = ai_global_usage.count + 1
  returning count into v_count;

  return v_count;
end;
$$;
