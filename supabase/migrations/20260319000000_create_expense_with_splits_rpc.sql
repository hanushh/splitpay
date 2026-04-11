-- Atomically insert an expense and its splits in a single transaction.
-- Called from the client instead of two separate inserts so that a splits
-- failure cannot leave a stranded expense with no splits.

CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id         UUID,
  p_description      TEXT,
  p_amount_cents     INTEGER,
  p_paid_by_member_id UUID,
  p_category         TEXT,
  p_receipt_url      TEXT,
  p_split_member_ids UUID[]
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

  -- Compute equal splits (last member absorbs rounding difference)
  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

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

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[]
) TO authenticated;
