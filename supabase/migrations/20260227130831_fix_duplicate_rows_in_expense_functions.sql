-- Fix get_group_expenses: use LATERAL to get exactly one membership row
CREATE OR REPLACE FUNCTION public.get_group_expenses(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  expense_id          UUID,
  description         TEXT,
  total_amount_cents  INTEGER,
  category            TEXT,
  created_at          TIMESTAMPTZ,
  paid_by_name        TEXT,
  paid_by_is_user     BOOLEAN,
  your_split_cents    INTEGER
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT
    e.id,
    e.description,
    e.amount_cents,
    e.category,
    e.created_at,
    COALESCE(payer.display_name, 'Someone') AS paid_by_name,
    (payer.user_id = p_user_id)             AS paid_by_is_user,
    COALESCE(my_split.amount_cents, 0)      AS your_split_cents
  FROM public.expenses e
  JOIN LATERAL (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
    LIMIT 1
  ) membership ON true
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  WHERE e.group_id = p_group_id
  ORDER BY e.created_at DESC;
$$;

-- Fix get_user_activity: same lateral approach
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
  your_split_cents    INTEGER
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
    COALESCE(payer.display_name, 'Someone') AS paid_by_name,
    payer.avatar_url                          AS paid_by_avatar,
    (payer.user_id = p_user_id)              AS paid_by_is_user,
    COALESCE(my_split.amount_cents, 0)       AS your_split_cents
  FROM public.expenses e
  JOIN public.groups g ON g.id = e.group_id
  JOIN LATERAL (
    SELECT id FROM public.group_members
    WHERE group_id = e.group_id AND user_id = p_user_id
    LIMIT 1
  ) membership ON true
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
$$;;
