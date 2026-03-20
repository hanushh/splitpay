-- 20260321000000_multi_currency_balances.sql
--
-- Expands group_balances PK to (group_id, user_id, currency_code) and adds
-- currency_code to settlements.  All balance-touching RPCs are updated so that
-- a group with ₹500 and $200 of expenses maintains two independent ledger rows
-- instead of conflating them into one balance_cents bucket.
--
-- Depends on: 20260320000002_add_currency_to_expenses.sql
--   (expenses.currency_code already exists)

-- ── 1a. group_balances: add currency_code column, rebuild PK ──────────────────

ALTER TABLE public.group_balances
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR';

-- Drop old 2-column PK; add new 3-column PK.
ALTER TABLE public.group_balances DROP CONSTRAINT group_balances_pkey;
ALTER TABLE public.group_balances ADD PRIMARY KEY (group_id, user_id, currency_code);

-- ── 1b. settlements: add currency_code column ─────────────────────────────────

ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'INR';

-- ── 1c. create_expense_with_splits (9-param, SECURITY DEFINER) ────────────────
-- Replaces the SECURITY INVOKER version from 20260320000002 with one that
-- also updates group_balances (per currency) atomically.

DROP FUNCTION IF EXISTS public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[], TEXT
);
CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id            UUID,
  p_description         TEXT,
  p_amount_cents        INTEGER,
  p_paid_by_member_id   UUID,
  p_category            TEXT,
  p_receipt_url         TEXT,
  p_split_member_ids    UUID[],
  p_split_amounts_cents INTEGER[] DEFAULT NULL,
  p_currency_code       TEXT      DEFAULT 'INR'
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
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url, currency_code
  ) VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url, p_currency_code
  ) RETURNING id INTO v_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

  SELECT user_id INTO v_payer_user_id
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
      VALUES (v_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (p_group_id, v_user_id, p_currency_code, -v_split_amount)
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
      VALUES (v_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (p_group_id, v_user_id, p_currency_code, -v_split_amount)
          ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
            SET balance_cents = public.group_balances.balance_cents - v_split_amount;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Payer's balance increases by (total paid − their own share) in p_currency_code
  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_currency_code, p_amount_cents - v_payer_split)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_payer_split);
  END IF;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[], TEXT
) TO authenticated;

-- ── 1d. delete_expense ────────────────────────────────────────────────────────
-- Adds currency_code filter so reversals only affect the correct ledger row.

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
  SELECT * INTO v_expense FROM public.expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  IF NOT public.is_group_member(v_expense.group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  SELECT user_id INTO v_payer_user_id
  FROM public.group_members WHERE id = v_expense.paid_by_member_id;

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
        WHERE group_id = v_expense.group_id
          AND user_id = v_split_user_id
          AND currency_code = v_expense.currency_code;
      END IF;
    END IF;
  END LOOP;

  IF v_payer_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - (v_expense.amount_cents - v_payer_split)
    WHERE group_id = v_expense.group_id
      AND user_id = v_payer_user_id
      AND currency_code = v_expense.currency_code;
  END IF;

  DELETE FROM public.expenses WHERE id = p_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_expense(UUID) TO authenticated;

-- ── 1e. record_settlement ─────────────────────────────────────────────────────
-- Adds p_currency_code param. Uses UPSERT for balance updates because the
-- currency bucket may not yet exist for users who have never had an expense
-- in that currency (e.g. a cash settlement outside expense flow).

DROP FUNCTION IF EXISTS public.record_settlement(UUID, UUID, INTEGER, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.record_settlement(
  p_group_id           UUID,
  p_payee_member_id    UUID,
  p_amount_cents       INTEGER,
  p_payment_method     TEXT DEFAULT 'cash',
  p_note               TEXT DEFAULT NULL,
  p_payer_member_id    UUID DEFAULT NULL,
  p_currency_code      TEXT DEFAULT 'INR'
)
RETURNS UUID
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id    UUID;
  v_caller_member_id UUID;
  v_actual_payer_id  UUID;
  v_payer_user_id    UUID;
  v_payee_user_id    UUID;
BEGIN
  SELECT id INTO v_caller_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  IF p_payer_member_id IS NOT NULL THEN
    IF p_payee_member_id != v_caller_member_id THEN
      RAISE EXCEPTION 'When specifying a payer, you must be the payee';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE id = p_payer_member_id AND group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Payer is not a member of this group';
    END IF;
    v_actual_payer_id := p_payer_member_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE id = p_payee_member_id AND group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Payee is not a member of this group';
    END IF;
    v_actual_payer_id := v_caller_member_id;
  END IF;

  SELECT user_id INTO v_payer_user_id FROM public.group_members WHERE id = v_actual_payer_id;
  SELECT user_id INTO v_payee_user_id FROM public.group_members WHERE id = p_payee_member_id;

  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note, currency_code
  )
  VALUES (
    p_group_id, v_actual_payer_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note, p_currency_code
  )
  RETURNING id INTO v_settlement_id;

  -- Payer's balance increases (they paid, owe less / are owed more)
  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_currency_code, p_amount_cents)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + p_amount_cents;
  END IF;

  -- Payee's balance decreases (they received, owed less / owe more)
  IF v_payee_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payee_user_id, p_currency_code, -p_amount_cents)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents - p_amount_cents;
  END IF;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_settlement TO authenticated;

-- ── 1f. get_group_member_balances ─────────────────────────────────────────────
-- Return type changes: added currency_code column. Must DROP first.
-- Returns one row per (member, currency) pair; HAVING removes zeroed-out rows.

DROP FUNCTION IF EXISTS public.get_group_member_balances(UUID, UUID);

CREATE OR REPLACE FUNCTION public.get_group_member_balances(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  member_id     UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  currency_code TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_member AS (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id LIMIT 1
  ),
  owed_to_me AS (
    SELECT es.member_id, e.currency_code, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, e.currency_code,
           -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  settled AS (
    SELECT
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END AS member_id,
      currency_code,
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN -amount_cents::BIGINT
        ELSE                                                     amount_cents::BIGINT
      END AS balance_cents
    FROM public.settlements
    WHERE group_id = p_group_id
      AND (
        payer_member_id = (SELECT id FROM my_member)
        OR payee_member_id = (SELECT id FROM my_member)
      )
  ),
  all_entries AS (
    SELECT member_id, currency_code, balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, currency_code, balance_cents FROM i_owe
    UNION ALL
    SELECT member_id, currency_code, -balance_cents FROM settled
  )
  SELECT
    gm.id,
    gm.display_name,
    gm.avatar_url,
    ae.currency_code,
    SUM(ae.balance_cents) AS balance_cents
  FROM all_entries ae
  JOIN public.group_members gm ON gm.id = ae.member_id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url, ae.currency_code
  HAVING SUM(ae.balance_cents) != 0
  ORDER BY gm.id, ae.currency_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_member_balances(UUID, UUID) TO authenticated;

-- ── 1g. get_friend_balances ───────────────────────────────────────────────────
-- Return type changes: added currency_code column. Must DROP first.
-- Returns one row per (user, currency) pair.

DROP FUNCTION IF EXISTS public.get_friend_balances(UUID);

CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  currency_code TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_members AS (
    SELECT id AS member_id, group_id
    FROM public.group_members WHERE user_id = p_user_id
  ),
  owed_to_me AS (
    SELECT es.member_id, e.currency_code, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, e.currency_code,
           -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  settled AS (
    SELECT
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN s.payee_member_id
        ELSE s.payer_member_id
      END AS member_id,
      s.currency_code,
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN -s.amount_cents::BIGINT
        ELSE   s.amount_cents::BIGINT
      END AS balance_cents
    FROM public.settlements s
    WHERE (
      s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
      OR s.payee_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
    )
  ),
  all_entries AS (
    SELECT member_id, currency_code, balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, currency_code, balance_cents FROM i_owe
    UNION ALL
    SELECT member_id, currency_code, -balance_cents FROM settled
  )
  SELECT
    gm.user_id,
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    ae.currency_code,
    SUM(ae.balance_cents) AS balance_cents
  FROM all_entries ae
  JOIN public.group_members gm ON gm.id = ae.member_id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.user_id, gm.display_name, ae.currency_code
  HAVING SUM(ae.balance_cents) != 0
  ORDER BY gm.user_id, ae.currency_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_friend_balances(UUID) TO authenticated;

-- ── 1h. Repair block ──────────────────────────────────────────────────────────
-- Delete all existing group_balances rows, then recompute from scratch per
-- currency using the current expense_splits + settlements data.
-- Afterwards, zero-balance rows are removed.

DO $$ BEGIN

  DELETE FROM public.group_balances;

  -- Payer credit: payer gets +split_amount per currency for every non-payer split
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    e.group_id,
    payer.user_id,
    e.currency_code,
    SUM(es.amount_cents)::BIGINT
  FROM public.expense_splits es
  JOIN public.expenses e ON e.id = es.expense_id
  JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  WHERE es.member_id != e.paid_by_member_id
    AND payer.user_id IS NOT NULL
  GROUP BY e.group_id, payer.user_id, e.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Splittee debit: each non-payer owes their split amount per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    e.group_id,
    splittee.user_id,
    e.currency_code,
    -SUM(es.amount_cents)::BIGINT
  FROM public.expense_splits es
  JOIN public.expenses e ON e.id = es.expense_id
  JOIN public.group_members splittee ON splittee.id = es.member_id
  WHERE es.member_id != e.paid_by_member_id
    AND splittee.user_id IS NOT NULL
  GROUP BY e.group_id, splittee.user_id, e.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Settlement payer credit per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    s.group_id,
    payer.user_id,
    s.currency_code,
    SUM(s.amount_cents)::BIGINT
  FROM public.settlements s
  JOIN public.group_members payer ON payer.id = s.payer_member_id
  WHERE payer.user_id IS NOT NULL
  GROUP BY s.group_id, payer.user_id, s.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Settlement payee debit per currency
  INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
  SELECT
    s.group_id,
    payee.user_id,
    s.currency_code,
    -SUM(s.amount_cents)::BIGINT
  FROM public.settlements s
  JOIN public.group_members payee ON payee.id = s.payee_member_id
  WHERE payee.user_id IS NOT NULL
  GROUP BY s.group_id, payee.user_id, s.currency_code
  ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
    SET balance_cents = public.group_balances.balance_cents + EXCLUDED.balance_cents;

  -- Remove zeroed-out rows
  DELETE FROM public.group_balances WHERE balance_cents = 0;

END; $$;
