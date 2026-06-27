-- Reschedule auto-archive from daily to yearly (January 1st at 02:00 UTC).
select cron.unschedule(jobid)
  from cron.job
  where jobname = 'auto-archive-settled-groups';

select cron.schedule(
  'auto-archive-settled-groups',
  '0 2 1 1 *',
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
