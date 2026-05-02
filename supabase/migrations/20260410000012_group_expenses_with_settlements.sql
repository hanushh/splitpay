-- Add settlements to get_group_expenses so the group's expense/settlement
-- log shows individual settlements alongside expenses. Each settlement row
-- has category='settlement' and a populated payee_name.

DROP FUNCTION IF EXISTS public.get_group_expenses(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_group_expenses(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  expense_id          UUID,
  description         TEXT,
  total_amount_cents  INTEGER,
  category            TEXT,
  created_at          TIMESTAMPTZ,
  paid_by_name        TEXT,
  paid_by_is_user     BOOLEAN,
  your_split_cents    INTEGER,
  currency_code       TEXT,
  payee_name          TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM (

    -- Expenses
    SELECT
      e.id                                                          AS expense_id,
      e.description,
      e.amount_cents                                                AS total_amount_cents,
      e.category,
      e.created_at,
      COALESCE(payer.display_name, payer_profile.name, 'Someone')   AS paid_by_name,
      (payer.user_id = p_user_id)                                   AS paid_by_is_user,
      COALESCE(my_split.amount_cents, 0)                            AS your_split_cents,
      e.currency_code,
      NULL::TEXT                                                    AS payee_name
    FROM public.expenses e
    JOIN public.group_members membership
      ON membership.group_id = e.group_id AND membership.user_id = p_user_id
    LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
    LEFT JOIN public.expense_splits my_split
      ON my_split.expense_id = e.id AND my_split.member_id = membership.id
    WHERE e.group_id = p_group_id

    UNION ALL

    -- Settlements
    SELECT
      s.id                                                          AS expense_id,
      'Settlement'                                                  AS description,
      s.amount_cents                                                AS total_amount_cents,
      'settlement'                                                  AS category,
      s.created_at,
      COALESCE(payer.display_name, payer_profile.name, 'Someone')   AS paid_by_name,
      (payer.user_id = p_user_id)                                   AS paid_by_is_user,
      0                                                             AS your_split_cents,
      s.currency_code,
      COALESCE(payee.display_name, payee_profile.name, 'Someone')   AS payee_name
    FROM public.settlements s
    JOIN public.group_members membership
      ON membership.group_id = s.group_id AND membership.user_id = p_user_id
    JOIN public.group_members payer ON payer.id = s.payer_member_id
    LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
    JOIN public.group_members payee ON payee.id = s.payee_member_id
    LEFT JOIN public.profiles payee_profile ON payee_profile.id = payee.user_id
    WHERE s.group_id = p_group_id

  ) combined
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_expenses TO authenticated;
