-- Send email (via invitation records) and in-app notifications
-- whenever members are directly added to a group.

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  group_id uuid references public.groups(id) on delete set null,
  type text not null default 'group_member_added',
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_user_created
  on public.user_notifications(user_id, created_at desc);

alter table public.user_notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'users can read own notifications'
  ) then
    create policy "users can read own notifications"
      on public.user_notifications
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'users can update own notifications'
  ) then
    create policy "users can update own notifications"
      on public.user_notifications
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.add_group_members_by_ids(
  p_group_id uuid,
  p_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user uuid := auth.uid();
  v_added_count integer := 0;
  v_group_name text := 'a group';
  v_actor_name text := 'Someone';
  v_inserted_user_ids uuid[] := '{}';
begin
  if v_auth_user is null then
    raise exception 'Not authenticated';
  end if;

  if p_group_id is null then
    raise exception 'Group id is required';
  end if;

  if p_user_ids is null or coalesce(array_length(p_user_ids, 1), 0) = 0 then
    return 0;
  end if;

  -- Only existing group members can add other existing users.
  if not exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = v_auth_user
  ) then
    raise exception 'Not authorized to add members to this group';
  end if;

  select coalesce(g.name, 'a group')
  into v_group_name
  from public.groups g
  where g.id = p_group_id;

  select coalesce(p.name, split_part(u.email, '@', 1), 'Someone')
  into v_actor_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = v_auth_user;

  with normalized as (
    select distinct unnest(p_user_ids) as user_id
  ),
  candidates as (
    select n.user_id
    from normalized n
    where n.user_id is not null
      and n.user_id <> v_auth_user
      and not exists (
        select 1
        from public.group_members gm
        where gm.group_id = p_group_id
          and gm.user_id = n.user_id
      )
  ),
  inserted as (
    insert into public.group_members (group_id, user_id)
    select p_group_id, c.user_id
    from candidates c
    returning user_id
  )
  select coalesce(array_agg(user_id), '{}')
  into v_inserted_user_ids
  from inserted;

  v_added_count := coalesce(array_length(v_inserted_user_ids, 1), 0);

  if v_added_count = 0 then
    return 0;
  end if;

  -- Ensure a balance row exists for selected users.
  insert into public.group_balances (group_id, user_id, balance_cents)
  select p_group_id, uid, 0
  from unnest(v_inserted_user_ids) uid
  on conflict (group_id, user_id) do nothing;

  -- In-app notifications for users who were added directly.
  insert into public.user_notifications (user_id, actor_user_id, group_id, type, title, body, metadata)
  select
    uid,
    v_auth_user,
    p_group_id,
    'group_member_added',
    'You were added to a group',
    format('%s added you to "%s".', v_actor_name, v_group_name),
    jsonb_build_object(
      'group_id', p_group_id,
      'group_name', v_group_name,
      'added_by', v_auth_user
    )
  from unnest(v_inserted_user_ids) uid;

  -- Email invitation records for the added users.
  -- If you have an email worker/trigger on invitations, this will send email.
  insert into public.invitations (inviter_id, invitee_email, group_id, token, status, expires_at)
  select
    v_auth_user,
    u.email,
    p_group_id,
    encode(gen_random_bytes(12), 'hex'),
    'pending',
    now() + interval '7 days'
  from unnest(v_inserted_user_ids) uid
  join auth.users u on u.id = uid
  where u.email is not null;

  return v_added_count;
end;
$$;

revoke all on function public.add_group_members_by_ids(uuid, uuid[]) from public;
grant execute on function public.add_group_members_by_ids(uuid, uuid[]) to authenticated;
