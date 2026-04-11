-- Push notification cron jobs for re-engagement
-- E2: Activate Push Notification Re-engagement
--
-- Two jobs:
--   1. Daily at 10:00 UTC — 7-day unsettled balance reminder
--      Users with non-zero group_balances older than 7 days who haven't
--      received this nudge in the last 7 days get a notification inserted.
--   2. Daily at 09:00 UTC — day-after-expense nudge
--      Users who had an expense added yesterday where they owe money
--      and are not the payer get a reminder to review.

-- Ensure pg_cron and pg_net are available
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── Helper: insert a push notification if one hasn't been sent recently ──────
-- Used by both cron jobs below. Skips insert if a notification of the same
-- type for the same user was already sent within the last 7 days.
create or replace function public.maybe_insert_push_notification(
  p_user_id    uuid,
  p_type       text,
  p_title      text,
  p_body       text,
  p_metadata   jsonb default '{}'::jsonb,
  p_group_id   uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip if we already queued the same notification type for this user in the last 7 days
  if exists (
    select 1 from public.user_notifications
    where user_id   = p_user_id
      and type      = p_type
      and (p_group_id is null or group_id = p_group_id)
      and created_at > now() - interval '7 days'
  ) then
    return;
  end if;

  insert into public.user_notifications
    (user_id, type, title, body, metadata, group_id)
  values
    (p_user_id, p_type, p_title, p_body, p_metadata, p_group_id);
end;
$$;

-- ─── Cron job 1: 7-day unsettled balance reminder ─────────────────────────────
-- Runs daily at 10:00 UTC. Finds all users with a non-zero balance
-- in any group where the last activity was > 7 days ago.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'push-unsettled-balance-reminder';

select cron.schedule(
  'push-unsettled-balance-reminder',
  '0 10 * * *',
  $$
    select public.maybe_insert_push_notification(
      gb.user_id,
      'unsettled_balance_reminder',
      'You have an unsettled balance',
      case
        when gb.balance_cents > 0
          then 'Someone owes you money in ' || g.name || '. Remind them to settle up!'
        else
          'You owe money in ' || g.name || '. Tap to settle up.'
      end,
      jsonb_build_object('groupId', gb.group_id, 'balanceCents', gb.balance_cents),
      gb.group_id
    )
    from public.group_balances gb
    join public.groups g on g.id = gb.group_id
    where gb.balance_cents != 0
      and g.archived = false
      and g.updated_at < now() - interval '7 days'
      -- Only notify users with an active push token
      and exists (
        select 1 from public.user_push_tokens upt
        where upt.user_id = gb.user_id
          and upt.disabled_at is null
      )
  $$
);

-- ─── Cron job 2: Day-after-expense nudge ──────────────────────────────────────
-- Runs daily at 09:00 UTC. For each expense added yesterday, notify
-- the non-paying members that they owe money.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'push-day-after-expense-nudge';

select cron.schedule(
  'push-day-after-expense-nudge',
  '0 9 * * *',
  $$
    select public.maybe_insert_push_notification(
      gm.user_id,
      'expense_nudge',
      'Don''t forget to settle up',
      p_payer.display_name || ' paid for "' || e.description || '". You owe '
        || (es.amount_cents / 100.0)::text || '.',
      jsonb_build_object(
        'expenseId', e.id,
        'groupId',   e.group_id,
        'amountCents', es.amount_cents
      ),
      e.group_id
    )
    from public.expenses e
    join public.expense_splits es    on es.expense_id = e.id
    join public.group_members  gm    on gm.id = es.member_id
    join public.group_members  payer on payer.id = e.paid_by_member_id
    join public.profiles p_payer     on p_payer.id = payer.user_id
    where e.created_at >= current_date - interval '1 day'
      and e.created_at <  current_date
      -- Don't notify the payer about their own expense
      and gm.user_id != payer.user_id
      and gm.user_id is not null
      and exists (
        select 1 from public.user_push_tokens upt
        where upt.user_id = gm.user_id
          and upt.disabled_at is null
      )
  $$
);
