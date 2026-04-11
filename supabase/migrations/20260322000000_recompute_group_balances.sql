-- 20260322000000_recompute_group_balances.sql
--
-- Recompute all group_balances rows from scratch using expense_splits +
-- settlements as the source of truth.  Fixes stale currency rows left behind
-- by the old edit-expense path that updated expenses.currency_code directly
-- without touching group_balances.

DO $$ BEGIN

  DELETE FROM public.group_balances;

  -- Payer credit: payer gets +split_amount per currency for every non-payer split
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    e.group_id,
    payer.user_id,
    e.currency_code,
    SUM(es.amount_cents)::BIGINT
  FROM public.expense_splits es
  JOIN public.expenses e ON e.id = es.expense_id
  JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  WHERE es.member_id != e.paid_by_member_id
    AND payer.user_id IS NOT NULL
  GROUP BY e.group_id, payer.user_id, e.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Splittee debit: each non-payer owes their split amount per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    e.group_id,
    splittee.user_id,
    e.currency_code,
    -SUM(es.amount_cents)::BIGINT
  FROM public.expense_splits es
  JOIN public.expenses e ON e.id = es.expense_id
  JOIN public.group_members splittee ON splittee.id = es.member_id
  WHERE es.member_id != e.paid_by_member_id
    AND splittee.user_id IS NOT NULL
  GROUP BY e.group_id, splittee.user_id, e.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Settlement payer credit per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    s.group_id,
    payer.user_id,
    s.currency_code,
    SUM(s.amount_cents)::BIGINT
  FROM public.settlements s
  JOIN public.group_members payer ON payer.id = s.payer_member_id
  WHERE payer.user_id IS NOT NULL
  GROUP BY s.group_id, payer.user_id, s.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Settlement payee debit per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    s.group_id,
    payee.user_id,
    s.currency_code,
    -SUM(s.amount_cents)::BIGINT
  FROM public.settlements s
  JOIN public.group_members payee ON payee.id = s.payee_member_id
  WHERE payee.user_id IS NOT NULL
  GROUP BY s.group_id, payee.user_id, s.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Remove zeroed-out rows
  DELETE FROM public.group_balances WHERE balance_cents = 0;

END; $$;
