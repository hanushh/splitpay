-- Wire pg_cron → pg_net → cron-dispatch-push edge function.
-- Runs immediately after both reminder cron jobs (at 09:05 and 10:05 UTC)
-- to flush notification rows created by the reminder jobs.
--
-- Requires:
--   - pg_net extension (already available on Supabase)
--   - CRON_SECRET stored as a Postgres variable via supabase secrets (injected as app.settings.cron_secret)
--   - The cron-dispatch-push edge function deployed with --no-verify-jwt

create extension if not exists pg_net;

-- ─── Flush after day-after-expense nudge (09:05 UTC) ─────────────────────────
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'flush-push-notifications-0905';

select cron.schedule(
  'flush-push-notifications-0905',
  '5 9 * * *',
  $$
    select net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/cron-dispatch-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ─── Flush after unsettled balance reminder (10:05 UTC) ──────────────────────
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'flush-push-notifications-1005';

select cron.schedule(
  'flush-push-notifications-1005',
  '5 10 * * *',
  $$
    select net.http_post(
      url     := current_setting('app.supabase_functions_url', true) || '/cron-dispatch-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), '')
      ),
      body    := '{}'::jsonb
    );
  $$
);

-- ─── Note on configuration ────────────────────────────────────────────────────
-- Set these in your Supabase project settings → Database → Extensions → pg_net,
-- OR run once manually in the SQL editor after deploy:
--
--   ALTER DATABASE postgres SET app.supabase_functions_url = 'https://<project-ref>.supabase.co/functions/v1';
--   ALTER DATABASE postgres SET app.cron_secret = '<your-CRON_SECRET-value>';
