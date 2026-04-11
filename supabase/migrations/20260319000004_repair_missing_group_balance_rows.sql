-- The previous repair migration only updated existing group_balances rows.
-- Groups that had expenses but no balance row at all (e.g. demo groups seeded
-- before the balance-tracking code existed) were never touched.
--
-- This migration:
--   1. Inserts a zero-balance row for every (group_id, user_id) that exists in
--      group_members but is missing from group_balances.
--   2. Recalculates ALL group_balances rows (existing + newly inserted) from
--      expense_splits and settlements.

-- Step 1: create missing rows
INSERT INTO public.group_balances (group_id, user_id, balance_cents)
SELECT gm.group_id, gm.user_id, 0
FROM public.group_members gm
WHERE gm.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.group_balances gb
    WHERE gb.group_id = gm.group_id AND gb.user_id = gm.user_id
  )
ON CONFLICT (group_id, user_id) DO NOTHING;

-- Step 2: recalculate every row from scratch
DO $$
DECLARE
  r          RECORD;
  v_member   UUID;
  v_balance  BIGINT;
BEGIN
  FOR r IN
    SELECT group_id, user_id FROM public.group_balances
  LOOP
    -- Find this user's member_id in the group
    SELECT id INTO v_member
    FROM public.group_members
    WHERE group_id = r.group_id AND user_id = r.user_id
    LIMIT 1;

    IF v_member IS NULL THEN CONTINUE; END IF;

    -- Net from expense_splits
    SELECT COALESCE(SUM(
      CASE
        WHEN e.paid_by_member_id = v_member AND es.member_id != v_member
          THEN  es.amount_cents   -- others owe me
        WHEN es.member_id = v_member AND e.paid_by_member_id != v_member
          THEN -es.amount_cents   -- I owe others
        ELSE 0
      END
    ), 0)
    INTO v_balance
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = r.group_id
      AND (e.paid_by_member_id = v_member OR es.member_id = v_member);

    -- Adjust for settlements
    SELECT v_balance + COALESCE(SUM(
      CASE
        WHEN payee_member_id = v_member THEN  amount_cents
        WHEN payer_member_id = v_member THEN -amount_cents
        ELSE 0
      END
    ), 0)
    INTO v_balance
    FROM public.settlements
    WHERE group_id = r.group_id
      AND (payer_member_id = v_member OR payee_member_id = v_member);

    UPDATE public.group_balances
    SET balance_cents = v_balance
    WHERE group_id = r.group_id AND user_id = r.user_id;
  END LOOP;
END;
$$;
