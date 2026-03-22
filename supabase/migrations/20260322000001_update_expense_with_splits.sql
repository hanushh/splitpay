-- 20260322000001_update_expense_with_splits.sql
--
-- Atomic edit for an existing expense.  Reverses the old balance delta,
-- updates the expense row, replaces splits, and applies the new balance delta
-- — all in a single transaction.  Prevents the data-loss window that the
-- old client-side delete-then-recreate approach had.

CREATE OR REPLACE FUNCTION public.update_expense_with_splits(
  p_expense_id          UUID,
  p_description         TEXT,
  p_amount_cents        INTEGER,
  p_paid_by_member_id   UUID,
  p_category            TEXT,
  p_receipt_url         TEXT,
  p_split_member_ids    UUID[],
  p_split_amounts_cents INTEGER[] DEFAULT NULL,
  p_currency_code       TEXT      DEFAULT 'INR'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_expense        RECORD;
  v_old_split          RECORD;
  v_old_payer_user_id  UUID;
  v_old_payer_split    INTEGER := 0;
  v_member_count       INTEGER;
  v_per_person         INTEGER;
  v_remainder          INTEGER;
  v_member_id          UUID;
  v_idx                INTEGER;
  v_split_amount       INTEGER;
  v_user_id            UUID;
  v_new_payer_user_id  UUID;
  v_new_payer_split    INTEGER := 0;
BEGIN
  -- Load old expense
  SELECT * INTO v_old_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  -- Auth check
  IF NOT public.is_group_member(v_old_expense.group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- ── Step 1: Reverse old balance delta ────────────────────────────────────────

  SELECT user_id INTO v_old_payer_user_id
  FROM public.group_members WHERE id = v_old_expense.paid_by_member_id;

  FOR v_old_split IN
    SELECT member_id, amount_cents FROM public.expense_splits WHERE expense_id = p_expense_id
  LOOP
    IF v_old_split.member_id = v_old_expense.paid_by_member_id THEN
      v_old_payer_split := v_old_split.amount_cents;
    ELSE
      SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_old_split.member_id;
      IF v_user_id IS NOT NULL THEN
        UPDATE public.group_balances
        SET balance_cents = balance_cents + v_old_split.amount_cents
        WHERE group_id = v_old_expense.group_id
          AND user_id = v_user_id
          AND currency_code = v_old_expense.currency_code;
      END IF;
    END IF;
  END LOOP;

  IF v_old_payer_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - (v_old_expense.amount_cents - v_old_payer_split)
    WHERE group_id = v_old_expense.group_id
      AND user_id = v_old_payer_user_id
      AND currency_code = v_old_expense.currency_code;
  END IF;

  -- Remove zero-balance rows left over from the reversal
  DELETE FROM public.group_balances
  WHERE group_id = v_old_expense.group_id
    AND balance_cents = 0;

  -- ── Step 2: Update expense row ───────────────────────────────────────────────

  UPDATE public.expenses
  SET description       = p_description,
      amount_cents      = p_amount_cents,
      paid_by_member_id = p_paid_by_member_id,
      category          = p_category,
      receipt_url       = p_receipt_url,
      currency_code     = p_currency_code
  WHERE id = p_expense_id;

  -- ── Step 3: Replace splits ───────────────────────────────────────────────────

  DELETE FROM public.expense_splits WHERE expense_id = p_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

  SELECT user_id INTO v_new_payer_user_id
  FROM public.group_members WHERE id = p_paid_by_member_id;

  IF p_split_amounts_cents IS NOT NULL THEN
    IF array_length(p_split_amounts_cents, 1) <> v_member_count THEN
      RAISE EXCEPTION 'split_amounts_cents length must match split_member_ids length';
    END IF;
    IF (SELECT SUM(x) FROM unnest(p_split_amounts_cents) AS x) <> p_amount_cents THEN
      RAISE EXCEPTION 'Split amounts must sum to the total expense amount';
    END IF;
    FOR v_idx IN 1 .. v_member_count LOOP
      v_member_id    := p_split_member_ids[v_idx];
      v_split_amount := p_split_amounts_cents[v_idx];

      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (p_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_new_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (v_old_expense.group_id, v_user_id, p_currency_code, -v_split_amount)
          ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
            SET balance_cents = public.group_balances.balance_cents - v_split_amount;
        END IF;
      END IF;
    END LOOP;
  ELSE
    v_per_person := p_amount_cents / v_member_count;
    v_remainder  := p_amount_cents - (v_per_person * v_member_count);
    FOR v_idx IN 1 .. v_member_count LOOP
      v_member_id    := p_split_member_ids[v_idx];
      v_split_amount := CASE WHEN v_idx = v_member_count
                             THEN v_per_person + v_remainder
                             ELSE v_per_person END;

      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (p_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_new_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (v_old_expense.group_id, v_user_id, p_currency_code, -v_split_amount)
          ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
            SET balance_cents = public.group_balances.balance_cents - v_split_amount;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Step 4: Apply new payer credit ───────────────────────────────────────────

  IF v_new_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (v_old_expense.group_id, v_new_payer_user_id, p_currency_code, p_amount_cents - v_new_payer_split)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_new_payer_split);
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.update_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[], TEXT
) TO authenticated;
