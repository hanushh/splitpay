-- ── Expenses ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  description      TEXT        NOT NULL,
  amount_cents     INTEGER     NOT NULL CHECK (amount_cents > 0),
  paid_by_member_id UUID       REFERENCES public.group_members(id) ON DELETE SET NULL,
  category         TEXT        NOT NULL DEFAULT 'other',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Expense splits ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expense_splits (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID    NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  member_id    UUID    NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  UNIQUE (expense_id, member_id)
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.expenses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group members can read expenses"
  ON public.expenses FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "group members can insert expenses"
  ON public.expenses FOR INSERT
  WITH CHECK (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "group members can read expense_splits"
  ON public.expense_splits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
      AND public.is_group_member(e.group_id, auth.uid())
    )
  );

CREATE POLICY "group members can insert expense_splits"
  ON public.expense_splits FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_id
      AND public.is_group_member(e.group_id, auth.uid())
    )
  );

-- ── Activity feed function ────────────────────────────────────
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
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
$$;

-- ── Group expense list function ───────────────────────────────
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
  JOIN public.group_members membership
    ON membership.group_id = e.group_id AND membership.user_id = p_user_id
  LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
  LEFT JOIN public.expense_splits my_split
    ON my_split.expense_id = e.id AND my_split.member_id = membership.id
  WHERE e.group_id = p_group_id
  ORDER BY e.created_at DESC;
$$;

-- ── Per-member balances within a group ───────────────────────
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
    SELECT es.member_id, es.amount_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  combined AS (
    SELECT member_id,  amount_cents::BIGINT AS balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, -amount_cents::BIGINT AS balance_cents FROM i_owe
  )
  SELECT
    gm.id,
    gm.display_name,
    gm.avatar_url,
    COALESCE(SUM(c.balance_cents), 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN combined c ON c.member_id = gm.id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url
  ORDER BY ABS(COALESCE(SUM(c.balance_cents), 0)) DESC;
$$;

-- ── Cross-group friend balances ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
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
    SELECT es.member_id, es.amount_cents::BIGINT
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents::BIGINT
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  combined AS (
    SELECT member_id,  amount_cents AS balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, -amount_cents AS balance_cents FROM i_owe
  )
  SELECT
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    SUM(c.balance_cents) AS balance_cents
  FROM combined c
  JOIN public.group_members gm ON gm.id = c.member_id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.display_name
  ORDER BY ABS(SUM(c.balance_cents)) DESC;
$$;;
