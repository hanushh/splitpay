-- supabase/migrations/20260314100000_add_settlements.sql
-- Runs after 20260314000000_fix_recursive_rls_policies.sql (already on branch)

-- ── 1. settlements table ──────────────────────────────────────────────────────
CREATE TABLE public.settlements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  payer_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  payee_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount_cents     INTEGER     NOT NULL CHECK (amount_cents > 0),
  payment_method   TEXT        NOT NULL DEFAULT 'cash',
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_settlements_group_id ON public.settlements(group_id);
CREATE INDEX idx_settlements_payer    ON public.settlements(payer_member_id);
CREATE INDEX idx_settlements_payee    ON public.settlements(payee_member_id);

CREATE POLICY "group members can read settlements"
  ON public.settlements FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "group members can insert settlements"
  ON public.settlements FOR INSERT
  WITH CHECK (public.is_group_member(group_id, auth.uid()));

-- ── 2. record_settlement RPC ──────────────────────────────────────────────────
-- Derives payer from auth.uid() — caller cannot forge another user's payment.
-- SECURITY DEFINER so it can UPDATE group_balances for the payee (who is not the caller).
CREATE OR REPLACE FUNCTION public.record_settlement(
  p_group_id        UUID,
  p_payee_member_id UUID,
  p_amount_cents    INTEGER,
  p_payment_method  TEXT DEFAULT 'cash',
  p_note            TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id   UUID;
  v_payer_member_id UUID;
  v_payee_user_id   UUID;
BEGIN
  SELECT id INTO v_payer_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_payer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  SELECT user_id INTO v_payee_user_id
  FROM public.group_members
  WHERE id = p_payee_member_id AND group_id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payee is not a member of this group';
  END IF;

  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note
  )
  VALUES (
    p_group_id, v_payer_member_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note
  )
  RETURNING id INTO v_settlement_id;

  -- Payer's balance increases (they owe less / are owed more)
  UPDATE public.group_balances
  SET balance_cents = balance_cents + p_amount_cents
  WHERE group_id = p_group_id AND user_id = auth.uid();

  -- Payee's balance decreases (they are owed less / owe more)
  IF v_payee_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - p_amount_cents
    WHERE group_id = p_group_id AND user_id = v_payee_user_id;
  END IF;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_settlement TO authenticated;

-- ── 3. get_group_member_balances (full replacement) ───────────────────────────
-- Adds net_settlements CTE. Sign: payer=me → settled_cents=-amount;
-- counterparty=payer → settled_cents=+amount.
-- Final balance = raw_balance - settled_cents (double-negative increases toward 0).
CREATE OR REPLACE FUNCTION public.get_group_member_balances(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  member_id     UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_member AS (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id LIMIT 1
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  raw_balances AS (
    SELECT member_id, balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, balance_cents FROM i_owe
  ),
  net_settlements AS (
    SELECT
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END AS member_id,
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN -amount_cents::BIGINT
        ELSE                                                     amount_cents::BIGINT
      END AS settled_cents
    FROM public.settlements
    WHERE group_id = p_group_id
      AND (
        payer_member_id = (SELECT id FROM my_member)
        OR payee_member_id = (SELECT id FROM my_member)
      )
  )
  SELECT
    gm.id,
    gm.display_name,
    gm.avatar_url,
    COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN raw_balances    rb ON rb.member_id = gm.id
  LEFT JOIN net_settlements ns ON ns.member_id  = gm.id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url
  ORDER BY ABS(
    COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)
  ) DESC;
$$;

-- ── 4. get_friend_balances (full replacement) ─────────────────────────────────
-- Same settled_cents sign convention, scoped via my_members across all groups.
CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_members AS (
    SELECT id AS member_id, group_id
    FROM public.group_members WHERE user_id = p_user_id
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  expense_balances AS (
    SELECT member_id,  balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, -balance_cents FROM i_owe
  ),
  net_settlements AS (
    SELECT
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN s.payee_member_id
        ELSE s.payer_member_id
      END AS member_id,
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN -s.amount_cents::BIGINT
        ELSE   s.amount_cents::BIGINT
      END AS settled_cents
    FROM public.settlements s
    WHERE (
      s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
      OR s.payee_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
    )
  )
  SELECT
    gm.user_id,
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN expense_balances eb ON eb.member_id = gm.id
  LEFT JOIN net_settlements  ns ON ns.member_id  = gm.id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.display_name, gm.user_id
  HAVING COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) != 0
  ORDER BY ABS(COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)) DESC;
$$;

-- ── 5. get_user_activity (full replacement) ───────────────────────────────────
-- UNIONs settlements into expenses. ORDER BY/LIMIT on outermost subquery.
-- Adds payee_name column (NULL for expenses, payee display_name for settlements).
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
  payee_name          TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM (
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
      NULL::TEXT                               AS payee_name
    FROM public.expenses e
    JOIN public.groups g ON g.id = e.group_id
    JOIN public.group_members membership
      ON membership.group_id = e.group_id AND membership.user_id = p_user_id
    LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
    LEFT JOIN public.expense_splits my_split
      ON my_split.expense_id = e.id AND my_split.member_id = membership.id

    UNION ALL

    SELECT
      s.id,
      s.group_id,
      g.name,
      'Settlement'                       AS description,
      s.amount_cents,
      'settlement'                       AS category,
      s.created_at,
      payer.display_name                 AS paid_by_name,
      payer.avatar_url                   AS paid_by_avatar,
      (payer.user_id = p_user_id)       AS paid_by_is_user,
      s.amount_cents                     AS your_split_cents,
      payee.display_name                 AS payee_name
    FROM public.settlements s
    JOIN public.groups g ON g.id = s.group_id
    JOIN LATERAL (
      SELECT id FROM public.group_members
      WHERE group_id = s.group_id AND user_id = p_user_id
      LIMIT 1
    ) membership ON true
    JOIN public.group_members payer ON payer.id = s.payer_member_id
    JOIN public.group_members payee ON payee.id = s.payee_member_id
    WHERE s.payer_member_id = membership.id OR s.payee_member_id = membership.id
  ) combined
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
