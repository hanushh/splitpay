-- AI chat usage tracking for server-side rate limiting

create table if not exists public.ai_chat_usage (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  usage_date  date    not null default current_date,
  count       integer not null default 0,
  primary key (user_id, usage_date)
);

alter table public.ai_chat_usage enable row level security;

-- Users can read their own usage (for display purposes)
create policy "users_read_own_ai_usage"
  on public.ai_chat_usage for select
  using (auth.uid() = user_id);

create index if not exists ai_chat_usage_user_date_idx
  on public.ai_chat_usage (user_id, usage_date);

-- Atomically increment usage and return new count.
-- Called by the ai-chat edge function (service role, bypasses RLS).
create or replace function public.increment_ai_usage(
  p_user_id uuid,
  p_date    date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.ai_chat_usage (user_id, usage_date, count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, usage_date)
  do update set count = ai_chat_usage.count + 1
  returning count into v_count;

  return v_count;
end;
$$;
