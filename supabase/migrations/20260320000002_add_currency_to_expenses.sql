-- Add currency_code to expenses so each expense remembers the currency it was
-- entered in, regardless of the user's current global currency setting.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR';

-- Replace create_expense_with_splits to accept and persist currency_code.
-- The old signature (without p_currency_code) is replaced in-place; existing
-- callers omitting the new parameter will receive the default 'INR'.
CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id            UUID,
  p_description         TEXT,
  p_amount_cents        INTEGER,
  p_paid_by_member_id   UUID,
  p_category            TEXT,
  p_receipt_url         TEXT,
  p_split_member_ids    UUID[],
  p_split_amounts_cents INTEGER[] DEFAULT NULL,
  p_currency_code       TEXT DEFAULT 'INR'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_expense_id   UUID;
  v_member_count INTEGER;
  v_per_person   INTEGER;
  v_remainder    INTEGER;
  v_member_id    UUID;
  v_idx          INTEGER;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url, currency_code
  )
  VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url, p_currency_code
  )
  RETURNING id INTO v_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

  IF p_split_amounts_cents IS NOT NULL THEN
    IF array_length(p_split_amounts_cents, 1) <> v_member_count THEN
      RAISE EXCEPTION 'split_amounts_cents length must match split_member_ids length';
    END IF;
    IF (SELECT SUM(x) FROM unnest(p_split_amounts_cents) AS x) <> p_amount_cents THEN
      RAISE EXCEPTION 'Split amounts must sum to the total expense amount';
    END IF;
    FOR v_idx IN 1 .. v_member_count LOOP
      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (v_expense_id, p_split_member_ids[v_idx], p_split_amounts_cents[v_idx]);
    END LOOP;
  ELSE
    v_per_person := p_amount_cents / v_member_count;
    v_remainder  := p_amount_cents - (v_per_person * v_member_count);
    FOR v_idx IN 1 .. v_member_count LOOP
      v_member_id := p_split_member_ids[v_idx];
      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (
        v_expense_id,
        v_member_id,
        CASE WHEN v_idx = v_member_count THEN v_per_person + v_remainder ELSE v_per_person END
      );
    END LOOP;
  END IF;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[], TEXT
) TO authenticated;

-- Update get_group_expenses to return currency_code so the client can format
-- each expense amount with its original currency symbol.
-- Must DROP first because PostgreSQL disallows changing a function's return type
-- via CREATE OR REPLACE.
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
    COALESCE(payer.display_name, 'Someone') AS paid_by_name,
    (payer.user_id = p_user_id)             AS paid_by_is_user,
    COALESCE(my_split.amount_cents, 0)      AS your_split_cents,
    e.currency_code
  FROM public.expenses e
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  WHERE e.group_id = p_group_id
  ORDER BY e.created_at DESC;
$$;

-- Update get_user_activity to also return currency_code for the activity feed.
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
    COALESCE(payer.display_name, 'Someone') AS paid_by_name,
    payer.avatar_url                          AS paid_by_avatar,
    (payer.user_id = p_user_id)              AS paid_by_is_user,
    COALESCE(my_split.amount_cents, 0)       AS your_split_cents,
    e.currency_code
  FROM public.expenses e
  JOIN public.groups g ON g.id = e.group_id
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
$$;
