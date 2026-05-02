-- Fix get_user_activity: migration 20260410000007 accidentally dropped the
-- settlements UNION when fixing the payer name lookup. Restore settlements
-- and apply the profiles join for name fallbacks in both branches.

DROP FUNCTION IF EXISTS public.get_user_activity(UUID, INT);
CREATE OR REPLACE FUNCTION public.get_user_activity(p_user_id UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (
  expense_id          UUID,
  group_id            UUID,
  group_name          TEXT,
  description         TEXT,
  total_amount_cents  INTEGER,
  category            TEXT,
  created_at          TIMESTAMPTZ,
  paid_by_name        TEXT,
  paid_by_avatar      TEXT,
  paid_by_is_user     BOOLEAN,
  your_split_cents    INTEGER,
  currency_code       TEXT,
  payee_name          TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM (

    -- Expenses
    SELECT
      e.id,
      e.group_id,
      g.name,
      e.description,
      e.amount_cents,
      e.category,
      e.created_at,
      COALESCE(payer.display_name, payer_profile.name, 'Someone') AS paid_by_name,
      COALESCE(payer.avatar_url, payer_profile.avatar_url)         AS paid_by_avatar,
      (payer.user_id = p_user_id)                                  AS paid_by_is_user,
      COALESCE(my_split.amount_cents, 0)                           AS your_split_cents,
      e.currency_code,
      NULL::TEXT                                                   AS payee_name
    FROM public.expenses e
    JOIN public.groups g ON g.id = e.group_id
    JOIN public.group_members membership
      ON membership.group_id = e.group_id AND membership.user_id = p_user_id
    LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
    LEFT JOIN public.expense_splits my_split
      ON my_split.expense_id = e.id AND my_split.member_id = membership.id

    UNION ALL

    -- Settlements
    SELECT
      s.id,
      s.group_id,
      g.name,
      'Settlement'                                                  AS description,
      s.amount_cents,
      'settlement'                                                  AS category,
      s.created_at,
      COALESCE(payer.display_name, payer_profile.name, 'Someone')  AS paid_by_name,
      COALESCE(payer.avatar_url, payer_profile.avatar_url)          AS paid_by_avatar,
      (payer.user_id = p_user_id)                                   AS paid_by_is_user,
      s.amount_cents                                                AS your_split_cents,
      s.currency_code,
      COALESCE(payee.display_name, payee_profile.name, 'Someone')  AS payee_name
    FROM public.settlements s
    JOIN public.groups g ON g.id = s.group_id
    JOIN LATERAL (
      SELECT id FROM public.group_members
      WHERE group_id = s.group_id AND user_id = p_user_id
      LIMIT 1
    ) membership ON true
    JOIN public.group_members payer ON payer.id = s.payer_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
    JOIN public.group_members payee ON payee.id = s.payee_member_id
    LEFT JOIN public.profiles payee_profile ON payee_profile.id = payee.user_id
    WHERE s.payer_member_id = membership.id OR s.payee_member_id = membership.id

  ) combined
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_activity TO authenticated;
