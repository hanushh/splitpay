-- Re-implement get_all_group_balances to compute net balances on-the-fly
-- from expense_splits + settlements, instead of trusting the (potentially
-- stale) group_balances cache. This mirrors how get_group_member_balances
-- computes pairwise balances, but returns group-perspective net balances
-- per member per currency.
--
-- Net balance per member per currency =
--   + (expenses paid by member)
--   - (sum of member's splits)
--   + (settlements where member is payer)
--   - (settlements where member is payee)

DROP FUNCTION IF EXISTS public.get_all_group_balances(UUID);

CREATE OR REPLACE FUNCTION public.get_all_group_balances(p_group_id UUID)
RETURNS TABLE (
  member_id     UUID,
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  currency_code TEXT,
  balance_cents BIGINT
)
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  WITH paid AS (
    SELECT e.paid_by_member_id AS member_id,
           e.currency_code,
           SUM(e.amount_cents)::BIGINT AS amount
    FROM public.expenses e
    WHERE e.group_id = p_group_id
    GROUP BY e.paid_by_member_id, e.currency_code
  ),
  owed AS (
    SELECT es.member_id,
           e.currency_code,
           SUM(es.amount_cents)::BIGINT AS amount
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
    GROUP BY es.member_id, e.currency_code
  ),
  settled_payer AS (
    SELECT s.payer_member_id AS member_id,
           s.currency_code,
           SUM(s.amount_cents)::BIGINT AS amount
    FROM public.settlements s
    WHERE s.group_id = p_group_id
    GROUP BY s.payer_member_id, s.currency_code
  ),
  settled_payee AS (
    SELECT s.payee_member_id AS member_id,
           s.currency_code,
           SUM(s.amount_cents)::BIGINT AS amount
    FROM public.settlements s
    WHERE s.group_id = p_group_id
    GROUP BY s.payee_member_id, s.currency_code
  ),
  all_currencies AS (
    SELECT member_id, currency_code FROM paid
    UNION
    SELECT member_id, currency_code FROM owed
    UNION
    SELECT member_id, currency_code FROM settled_payer
    UNION
    SELECT member_id, currency_code FROM settled_payee
  ),
  computed AS (
    SELECT
      ac.member_id,
      ac.currency_code,
      COALESCE(p.amount, 0)
        - COALESCE(o.amount, 0)
        + COALESCE(sp.amount, 0)
        - COALESCE(se.amount, 0) AS balance_cents
    FROM all_currencies ac
    LEFT JOIN paid          p  ON p.member_id  = ac.member_id AND p.currency_code  = ac.currency_code
    LEFT JOIN owed          o  ON o.member_id  = ac.member_id AND o.currency_code  = ac.currency_code
    LEFT JOIN settled_payer sp ON sp.member_id = ac.member_id AND sp.currency_code = ac.currency_code
    LEFT JOIN settled_payee se ON se.member_id = ac.member_id AND se.currency_code = ac.currency_code
  )
  SELECT
    gm.id                                          AS member_id,
    gm.user_id,
    COALESCE(gm.display_name, pr.name, 'Unknown')  AS display_name,
    COALESCE(gm.avatar_url, pr.avatar_url)         AS avatar_url,
    c.currency_code,
    c.balance_cents
  FROM public.group_members gm
  LEFT JOIN public.profiles pr ON pr.id = gm.user_id
  LEFT JOIN computed c ON c.member_id = gm.id
  WHERE gm.group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_group_balances TO authenticated;
