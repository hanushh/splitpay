-- Adds UPDATE (archive) and DELETE policies for group creators.
-- Also schedules daily auto-archive of settled groups via pg_cron.

-- 1. Allow group creator to update (archive) their group
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'groups_update_creator'
  ) then
    create policy groups_update_creator
      on public.groups
      for update
      to authenticated
      using (created_by = auth.uid())
      with check (created_by = auth.uid());
  end if;
end $$;

-- 2. Allow group creator to delete their group
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'groups'
      and policyname = 'groups_delete_creator'
  ) then
    create policy groups_delete_creator
      on public.groups
      for delete
      to authenticated
      using (created_by = auth.uid());
  end if;
end $$;

-- 3. Enable pg_cron and schedule daily auto-archive of settled groups
-- NOTE: This job runs as the database superuser and intentionally bypasses RLS.
-- It is safe because it only reads group_balances and updates groups — no user data leakage.
create extension if not exists pg_cron;

-- Idempotent: remove existing job if present, then re-create
select cron.unschedule(jobid)
  from cron.job
  where jobname = 'auto-archive-settled-groups';

select cron.schedule(
  'auto-archive-settled-groups',
  '0 2 * * *',
  $$
    UPDATE public.groups
    SET archived = true
    WHERE archived = false
      AND updated_at < NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.group_balances
        WHERE public.group_balances.group_id = public.groups.id
          AND balance_cents != 0
      )
  $$
);
