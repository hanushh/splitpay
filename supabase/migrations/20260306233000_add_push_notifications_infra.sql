-- Push notification infrastructure for mobile devices.
-- Tracks device tokens and delivery status for user_notifications rows.

create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'unknown' check (platform in ('ios', 'android', 'unknown')),
  device_name text,
  disabled_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_push_tokens_user_active
  on public.user_push_tokens (user_id, disabled_at, last_seen_at desc);

alter table public.user_push_tokens enable row level security;

alter table if exists public.user_notifications
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_attempts integer not null default 0,
  add column if not exists push_last_error text;

create index if not exists idx_user_notifications_push_pending
  on public.user_notifications (created_at asc)
  where push_sent_at is null;

create or replace function public.touch_user_push_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_push_tokens_updated_at on public.user_push_tokens;

create trigger trg_user_push_tokens_updated_at
before update on public.user_push_tokens
for each row execute function public.touch_user_push_tokens_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_push_tokens'
      and policyname = 'users can read own push tokens'
  ) then
    create policy "users can read own push tokens"
      on public.user_push_tokens
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_push_tokens'
      and policyname = 'users can insert own push tokens'
  ) then
    create policy "users can insert own push tokens"
      on public.user_push_tokens
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_push_tokens'
      and policyname = 'users can update own push tokens'
  ) then
    create policy "users can update own push tokens"
      on public.user_push_tokens
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_push_tokens'
      and policyname = 'users can delete own push tokens'
  ) then
    create policy "users can delete own push tokens"
      on public.user_push_tokens
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.upsert_push_token(
  p_token text,
  p_platform text default 'unknown',
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user uuid := auth.uid();
  v_platform text := lower(coalesce(trim(p_platform), 'unknown'));
  v_token text := nullif(trim(p_token), '');
  v_device_name text := nullif(trim(p_device_name), '');
begin
  if v_auth_user is null then
    raise exception 'Not authenticated';
  end if;

  if v_token is null then
    raise exception 'Push token is required';
  end if;

  if v_platform not in ('ios', 'android', 'unknown') then
    v_platform := 'unknown';
  end if;

  insert into public.user_push_tokens (user_id, token, platform, device_name, disabled_at, last_seen_at)
  values (v_auth_user, v_token, v_platform, v_device_name, null, now())
  on conflict (token)
  do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    device_name = coalesce(excluded.device_name, public.user_push_tokens.device_name),
    disabled_at = null,
    last_seen_at = now(),
    updated_at = now();
end;
$$;

create or replace function public.remove_push_token(
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user uuid := auth.uid();
  v_token text := nullif(trim(p_token), '');
begin
  if v_auth_user is null then
    raise exception 'Not authenticated';
  end if;

  if v_token is null then
    return;
  end if;

  update public.user_push_tokens
  set disabled_at = now(),
      updated_at = now()
  where user_id = v_auth_user
    and token = v_token
    and disabled_at is null;
end;
$$;

revoke all on function public.upsert_push_token(text, text, text) from public;
grant execute on function public.upsert_push_token(text, text, text) to authenticated;

revoke all on function public.remove_push_token(text) from public;
grant execute on function public.remove_push_token(text) to authenticated;
