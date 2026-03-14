-- supabase/migrations/20260314120000_fix_balance_cross_product.sql
-- Fix: the previous get_group_member_balances / get_friend_balances joined
-- raw_balances and net_settlements directly, causing a Cartesian product when
-- a member has N expense-split rows × M settlement rows.  Each CTE value was
-- multiplied by the row count of the *other* CTE instead of being summed once.
-- Fix: pre-aggregate each CTE to (member_id → total) before the final join.

-- ── get_group_member_balances ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_group_member_balances(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  member_id     UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_member AS (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id LIMIT 1
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  -- Pre-aggregate raw balances per member to avoid cross-product with settlements
  raw_totals AS (
    SELECT member_id, SUM(balance_cents) AS total
    FROM (SELECT member_id, balance_cents FROM owed_to_me
          UNION ALL
          SELECT member_id, balance_cents FROM i_owe) combined
    GROUP BY member_id
  ),
  -- Pre-aggregate settled amounts per member to avoid cross-product with raw balances
  settled_totals AS (
    SELECT
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END AS member_id,
      SUM(
        CASE
          WHEN payer_member_id = (SELECT id FROM my_member) THEN -amount_cents::BIGINT
          ELSE                                                     amount_cents::BIGINT
        END
      ) AS total
    FROM public.settlements
    WHERE group_id = p_group_id
      AND (
        payer_member_id = (SELECT id FROM my_member)
        OR payee_member_id = (SELECT id FROM my_member)
      )
    GROUP BY
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END
  )
  SELECT
    gm.id,
    gm.display_name,
    gm.avatar_url,
    COALESCE(rt.total, 0) - COALESCE(st.total, 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN raw_totals    rt ON rt.member_id = gm.id
  LEFT JOIN settled_totals st ON st.member_id = gm.id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  ORDER BY ABS(COALESCE(rt.total, 0) - COALESCE(st.total, 0)) DESC;
$$;

-- ── get_friend_balances ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_members AS (
    SELECT id AS member_id, group_id
    FROM public.group_members WHERE user_id = p_user_id
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  -- Pre-aggregate expense balances per member
  expense_totals AS (
    SELECT member_id, SUM(balance_cents) AS total
    FROM (SELECT member_id,  balance_cents FROM owed_to_me
          UNION ALL
          SELECT member_id, -balance_cents FROM i_owe) combined
    GROUP BY member_id
  ),
  -- Pre-aggregate settled amounts per member
  settled_totals AS (
    SELECT
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN s.payee_member_id
        ELSE s.payer_member_id
      END AS member_id,
      SUM(
        CASE
          WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
            THEN -s.amount_cents::BIGINT
          ELSE   s.amount_cents::BIGINT
        END
      ) AS total
    FROM public.settlements s
    WHERE (
      s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
      OR s.payee_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
    )
    GROUP BY
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN s.payee_member_id
        ELSE s.payer_member_id
      END
  )
  SELECT
    gm.user_id,
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    COALESCE(et.total, 0) - COALESCE(st.total, 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN expense_totals  et ON et.member_id = gm.id
  LEFT JOIN settled_totals  st ON st.member_id = gm.id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.display_name, gm.user_id, et.total, st.total
  HAVING COALESCE(et.total, 0) - COALESCE(st.total, 0) != 0
  ORDER BY ABS(COALESCE(et.total, 0) - COALESCE(st.total, 0)) DESC;
$$;
