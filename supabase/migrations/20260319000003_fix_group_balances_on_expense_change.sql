-- Fix: create_expense_with_splits did not update group_balances, so the
-- group header always showed a stale balance ("All settled up" even when it wasn't).
--
-- Changes:
--   1. Rebuild create_expense_with_splits as SECURITY DEFINER so it can update
--      group_balances for all members (including non-callers).
--   2. Add delete_expense RPC that reverses the balance delta before deleting.
--   3. Repair all existing stale group_balances rows from expense_splits.

-- ── 1. create_expense_with_splits ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id          UUID,
  p_description       TEXT,
  p_amount_cents      INTEGER,
  p_paid_by_member_id UUID,
  p_category          TEXT,
  p_receipt_url       TEXT,
  p_split_member_ids  UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id    UUID;
  v_member_count  INTEGER;
  v_per_person    INTEGER;
  v_remainder     INTEGER;
  v_member_id     UUID;
  v_idx           INTEGER;
  v_split_amount  INTEGER;
  v_user_id       UUID;
  v_payer_user_id UUID;
  v_payer_split   INTEGER := 0;
BEGIN
  -- Belt-and-suspenders auth check (RLS is also in place)
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- Insert expense
  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url
  ) VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url
  ) RETURNING id INTO v_expense_id;

  -- Split arithmetic
  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;
  v_per_person := p_amount_cents / v_member_count;
  v_remainder  := p_amount_cents - (v_per_person * v_member_count);

  -- Resolve payer's user_id once
  SELECT user_id INTO v_payer_user_id
  FROM public.group_members WHERE id = p_paid_by_member_id;

  -- Insert splits + update non-payer balances
  FOR v_idx IN 1 .. v_member_count LOOP
    v_member_id    := p_split_member_ids[v_idx];
    v_split_amount := CASE WHEN v_idx = v_member_count
                          THEN v_per_person + v_remainder
                          ELSE v_per_person END;

    INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
    VALUES (v_expense_id, v_member_id, v_split_amount);

    IF v_member_id = p_paid_by_member_id THEN
      v_payer_split := v_split_amount;   -- remember payer's own share
    ELSE
      -- This member owes the payer: decrease their balance
      SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
      IF v_user_id IS NOT NULL THEN
        INSERT INTO public.group_balances (group_id, user_id, balance_cents)
        VALUES (p_group_id, v_user_id, -v_split_amount)
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET balance_cents = public.group_balances.balance_cents - v_split_amount;
      END IF;
    END IF;
  END LOOP;

  -- Payer's balance increases by (amount paid − their own share)
  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_amount_cents - v_payer_split)
    ON CONFLICT (group_id, user_id) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_payer_split);
  END IF;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[]
) TO authenticated;


-- ── 2. delete_expense ────────────────────────────────────────────────────────
-- Reverses the group_balances delta produced when the expense was created,
-- then deletes the expense (splits cascade via FK).
CREATE OR REPLACE FUNCTION public.delete_expense(p_expense_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense        RECORD;
  v_split          RECORD;
  v_payer_user_id  UUID;
  v_split_user_id  UUID;
  v_payer_split    INTEGER := 0;
BEGIN
  -- Load the expense
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  -- Verify caller is a member of the group
  IF NOT public.is_group_member(v_expense.group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- Resolve payer's user_id
  SELECT user_id INTO v_payer_user_id
  FROM public.group_members WHERE id = v_expense.paid_by_member_id;

  -- Walk splits: reverse each non-payer's balance decrease
  FOR v_split IN
    SELECT member_id, amount_cents FROM public.expense_splits WHERE expense_id = p_expense_id
  LOOP
    IF v_split.member_id = v_expense.paid_by_member_id THEN
      v_payer_split := v_split.amount_cents;
    ELSE
      SELECT user_id INTO v_split_user_id FROM public.group_members WHERE id = v_split.member_id;
      IF v_split_user_id IS NOT NULL THEN
        UPDATE public.group_balances
        SET balance_cents = balance_cents + v_split.amount_cents
        WHERE group_id = v_expense.group_id AND user_id = v_split_user_id;
      END IF;
    END IF;
  END LOOP;

  -- Reverse payer's balance increase
  IF v_payer_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - (v_expense.amount_cents - v_payer_split)
    WHERE group_id = v_expense.group_id AND user_id = v_payer_user_id;
  END IF;

  -- Delete the expense (expense_splits cascade)
  DELETE FROM public.expenses WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;


-- ── 3. Repair existing stale group_balances ───────────────────────────────────
-- Recompute balance_cents for every (group_id, user_id) from expense_splits,
-- accounting for settlements. Runs once on migration; future changes are handled
-- by create_expense_with_splits / delete_expense / record_settlement.
DO $$
DECLARE
  r RECORD;
  v_member_id UUID;
  v_balance   BIGINT;
BEGIN
  FOR r IN
    SELECT gb.group_id, gb.user_id
    FROM public.group_balances gb
  LOOP
    -- Find this user's member row in the group
    SELECT id INTO v_member_id
    FROM public.group_members
    WHERE group_id = r.group_id AND user_id = r.user_id
    LIMIT 1;

    IF v_member_id IS NULL THEN CONTINUE; END IF;

    -- Net from expenses
    SELECT COALESCE(SUM(
      CASE
        WHEN e.paid_by_member_id = v_member_id AND es.member_id != v_member_id
          THEN  es.amount_cents      -- others owe me
        WHEN es.member_id = v_member_id AND e.paid_by_member_id != v_member_id
          THEN -es.amount_cents      -- I owe others
        ELSE 0
      END
    ), 0)
    INTO v_balance
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = r.group_id
      AND (e.paid_by_member_id = v_member_id OR es.member_id = v_member_id);

    -- Adjust for settlements
    SELECT v_balance + COALESCE(SUM(
      CASE
        WHEN payee_member_id = v_member_id THEN  amount_cents   -- I received a settlement
        WHEN payer_member_id = v_member_id THEN -amount_cents   -- I paid a settlement
        ELSE 0
      END
    ), 0)
    INTO v_balance
    FROM public.settlements
    WHERE group_id = r.group_id
      AND (payer_member_id = v_member_id OR payee_member_id = v_member_id);

    UPDATE public.group_balances
    SET balance_cents = v_balance
    WHERE group_id = r.group_id AND user_id = r.user_id;
  END LOOP;
END;
$$;
