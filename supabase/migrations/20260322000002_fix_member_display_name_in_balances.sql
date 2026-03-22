-- Fix get_group_member_balances to fall back to profiles.name when
-- group_members.display_name is NULL (i.e. for real registered users
-- whose name is stored in profiles, not in the group_members row).

DROP FUNCTION IF EXISTS public.get_group_member_balances(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_group_member_balances(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  member_id     UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  currency_code TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_member AS (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id LIMIT 1
  ),
  owed_to_me AS (
    SELECT es.member_id, e.currency_code, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, e.currency_code,
           -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  settled AS (
    SELECT
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END AS member_id,
      currency_code,
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN -amount_cents::BIGINT
        ELSE                                                     amount_cents::BIGINT
      END AS balance_cents
    FROM public.settlements
    WHERE group_id = p_group_id
      AND (
        payer_member_id = (SELECT id FROM my_member)
        OR payee_member_id = (SELECT id FROM my_member)
      )
  ),
  all_entries AS (
    SELECT member_id, currency_code, balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, currency_code, balance_cents FROM i_owe
    UNION ALL
    SELECT member_id, currency_code, -balance_cents FROM settled
  )
  SELECT
    gm.id,
    COALESCE(gm.display_name, p.name) AS display_name,
    COALESCE(gm.avatar_url, p.avatar_url) AS avatar_url,
    ae.currency_code,
    SUM(ae.balance_cents) AS balance_cents
  FROM all_entries ae
  JOIN public.group_members gm ON gm.id = ae.member_id
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url, p.name, p.avatar_url, ae.currency_code
  HAVING SUM(ae.balance_cents) != 0
  ORDER BY gm.id, ae.currency_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_member_balances(UUID, UUID) TO authenticated;
