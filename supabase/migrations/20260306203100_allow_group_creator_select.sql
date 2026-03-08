-- Allows a group creator to read their newly created group before membership row exists.
-- This unblocks insert(...).select(...) patterns during group creation.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'creators can read own groups'
  ) then
    create policy "creators can read own groups"
      on public.groups
      for select
      to authenticated
      using (created_by = auth.uid());
  end if;
end $$;
