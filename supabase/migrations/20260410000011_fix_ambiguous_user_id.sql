-- Fix: column reference "user_id" is ambiguous in get_all_group_balances.
-- The unqualified user_id in the membership EXISTS check collides with the
-- function's RETURNS TABLE user_id column. Qualify with the table alias.

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
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id AND gm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  WITH paid AS (
    SELECT e.paid_by_member_id AS m_id,
           e.currency_code AS cur,
           SUM(e.amount_cents)::BIGINT AS amount
    FROM public.expenses e
    WHERE e.group_id = p_group_id
    GROUP BY e.paid_by_member_id, e.currency_code
  ),
  owed AS (
    SELECT es.member_id AS m_id,
           e.currency_code AS cur,
           SUM(es.amount_cents)::BIGINT AS amount
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
    GROUP BY es.member_id, e.currency_code
  ),
  settled_payer AS (
    SELECT s.payer_member_id AS m_id,
           s.currency_code AS cur,
           SUM(s.amount_cents)::BIGINT AS amount
    FROM public.settlements s
    WHERE s.group_id = p_group_id
    GROUP BY s.payer_member_id, s.currency_code
  ),
  settled_payee AS (
    SELECT s.payee_member_id AS m_id,
           s.currency_code AS cur,
           SUM(s.amount_cents)::BIGINT AS amount
    FROM public.settlements s
    WHERE s.group_id = p_group_id
    GROUP BY s.payee_member_id, s.currency_code
  ),
  all_currencies AS (
    SELECT m_id, cur FROM paid
    UNION
    SELECT m_id, cur FROM owed
    UNION
    SELECT m_id, cur FROM settled_payer
    UNION
    SELECT m_id, cur FROM settled_payee
  ),
  computed AS (
    SELECT
      ac.m_id,
      ac.cur,
      COALESCE(p.amount, 0)
        - COALESCE(o.amount, 0)
        + COALESCE(sp.amount, 0)
        - COALESCE(se.amount, 0) AS bal
    FROM all_currencies ac
    LEFT JOIN paid          p  ON p.m_id  = ac.m_id AND p.cur  = ac.cur
    LEFT JOIN owed          o  ON o.m_id  = ac.m_id AND o.cur  = ac.cur
    LEFT JOIN settled_payer sp ON sp.m_id = ac.m_id AND sp.cur = ac.cur
    LEFT JOIN settled_payee se ON se.m_id = ac.m_id AND se.cur = ac.cur
  )
  SELECT
    gm.id                                          AS member_id,
    gm.user_id                                     AS user_id,
    COALESCE(gm.display_name, pr.name, 'Unknown')  AS display_name,
    COALESCE(gm.avatar_url, pr.avatar_url)         AS avatar_url,
    c.cur                                          AS currency_code,
    c.bal                                          AS balance_cents
  FROM public.group_members gm
  LEFT JOIN public.profiles pr ON pr.id = gm.user_id
  LEFT JOIN computed c ON c.m_id = gm.id
  WHERE gm.group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_group_balances TO authenticated;
