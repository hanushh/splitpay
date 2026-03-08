-- Add selected existing users directly to a group.
-- Intended for "pick users" UX (without email-only invites).

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
  select count(*) into v_added_count from inserted;

  -- Ensure a balance row exists for selected users.
  insert into public.group_balances (group_id, user_id, balance_cents)
  select p_group_id, n.user_id, 0
  from (
    select distinct unnest(p_user_ids) as user_id
  ) n
  where n.user_id is not null
  on conflict (group_id, user_id) do nothing;

  return v_added_count;
end;
$$;

revoke all on function public.add_group_members_by_ids(uuid, uuid[]) from public;
grant execute on function public.add_group_members_by_ids(uuid, uuid[]) to authenticated;
