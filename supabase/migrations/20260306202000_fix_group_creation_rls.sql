-- Fixes create-group flow blocked by RLS ("new row violates row-level security policy for table groups")
-- Safe to run multiple times.

-- Ensure RLS is enabled
alter table if exists public.groups enable row level security;
alter table if exists public.group_members enable row level security;
alter table if exists public.group_balances enable row level security;
alter table if exists public.invitations enable row level security;

-- Allow authenticated users to create groups they own.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'groups_insert_own'
  ) then
    create policy groups_insert_own
      on public.groups
      for insert
      to authenticated
      with check (created_by = auth.uid());
  end if;
end $$;

-- Allow group owner to insert their own membership row during group creation.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'group_members'
      and policyname = 'group_members_insert_owner'
  ) then
    create policy group_members_insert_owner
      on public.group_members
      for insert
      to authenticated
      with check (
        user_id = auth.uid()
        and exists (
          select 1
          from public.groups g
          where g.id = group_id
            and g.created_by = auth.uid()
        )
      );
  end if;
end $$;

-- Allow group owner to create their initial balance row.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'group_balances'
      and policyname = 'group_balances_insert_owner'
  ) then
    create policy group_balances_insert_owner
      on public.group_balances
      for insert
      to authenticated
      with check (
        user_id = auth.uid()
        and exists (
          select 1
          from public.groups g
          where g.id = group_id
            and g.created_by = auth.uid()
        )
      );
  end if;
end $$;

-- Allow group owner to create invitation rows.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'invitations'
      and policyname = 'invitations_insert_owner'
  ) then
    create policy invitations_insert_owner
      on public.invitations
      for insert
      to authenticated
      with check (
        inviter_id = auth.uid()
        and exists (
          select 1
          from public.groups g
          where g.id = group_id
            and g.created_by = auth.uid()
        )
      );
  end if;
end $$;
