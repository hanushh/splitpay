-- Wire pg_cron → pg_net → cron-dispatch-push edge function.
-- Runs immediately after both reminder cron jobs (at 09:05 and 10:05 UTC)
-- to flush notification rows created by the reminder jobs.
--
-- Requires:
--   - pg_net extension (already available on Supabase)
--   - The cron-dispatch-push edge function deployed with --no-verify-jwt
--
-- The Functions URL is hard-coded (no superuser ALTER DATABASE needed).
-- Optional security hardening: set CRON_SECRET in Supabase secrets dashboard;
-- the edge function will validate it when present.

create extension if not exists pg_net;

-- ─── Flush after day-after-expense nudge (09:05 UTC) ─────────────────────────
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'flush-push-notifications-0905';

select cron.schedule(
  'flush-push-notifications-0905',
  '5 9 * * *',
  $cron$
    select net.http_post(
      url     := 'https://yapfqffhgcncqxovjcsr.supabase.co/functions/v1/cron-dispatch-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
      ),
      body    := '{}'::jsonb
    );
  $cron$
);

-- ─── Flush after unsettled balance reminder (10:05 UTC) ──────────────────────
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'flush-push-notifications-1005';

select cron.schedule(
  'flush-push-notifications-1005',
  '5 10 * * *',
  $cron$
    select net.http_post(
      url     := 'https://yapfqffhgcncqxovjcsr.supabase.co/functions/v1/cron-dispatch-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
      ),
      body    := '{}'::jsonb
    );
  $cron$
);
