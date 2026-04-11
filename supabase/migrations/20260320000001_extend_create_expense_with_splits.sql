-- Extend create_expense_with_splits to support custom per-member split amounts.
-- When p_split_amounts_cents is provided, it is used directly instead of
-- computing equal splits. The array must have the same length as
-- p_split_member_ids and must sum exactly to p_amount_cents.

CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id            UUID,
  p_description         TEXT,
  p_amount_cents        INTEGER,
  p_paid_by_member_id   UUID,
  p_category            TEXT,
  p_receipt_url         TEXT,
  p_split_member_ids    UUID[],
  p_split_amounts_cents INTEGER[] DEFAULT NULL
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
  -- Verify caller is a member of the group (belt-and-suspenders on top of RLS)
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- Insert expense
  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url
  )
  VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url
  )
  RETURNING id INTO v_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

  IF p_split_amounts_cents IS NOT NULL THEN
    -- Validate custom amounts
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
    -- Equal split: last member absorbs rounding difference
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

-- Revoke old signature, grant new extended one
REVOKE EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[]
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[]
) TO authenticated;
