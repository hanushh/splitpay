-- Fix: get_group_expenses and get_user_activity used payer.display_name from
-- group_members, which is NULL for registered app users (their name lives in
-- profiles). Join profiles as a fallback so the payer name renders correctly.

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
  currency_code       TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT
    e.id,
    e.description,
    e.amount_cents,
    e.category,
    e.created_at,
    COALESCE(payer.display_name, payer_profile.name, 'Someone') AS paid_by_name,
    (payer.user_id = p_user_id)             AS paid_by_is_user,
    COALESCE(my_split.amount_cents, 0)      AS your_split_cents,
    e.currency_code
  FROM public.expenses e
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  WHERE e.group_id = p_group_id
  ORDER BY e.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_expenses TO authenticated;

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
  currency_code       TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
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
    e.currency_code
  FROM public.expenses e
  JOIN public.groups g ON g.id = e.group_id
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.profiles payer_profile ON payer_profile.id = payer.user_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_activity TO authenticated;
