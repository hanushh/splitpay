-- Admin role: add is_admin flag to profiles and create admin-only RPC functions

-- 1. Add is_admin column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 2. Admin stats: counts across the whole app
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS TABLE (
  total_users        bigint,
  total_groups       bigint,
  total_expenses     bigint,
  total_expense_amount_cents bigint,
  new_users_today    bigint,
  active_groups      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.profiles)::bigint,
    (SELECT count(*) FROM public.groups)::bigint,
    (SELECT count(*) FROM public.expenses)::bigint,
    (SELECT COALESCE(sum(amount_cents), 0) FROM public.expenses)::bigint,
    (SELECT count(*) FROM auth.users WHERE created_at::date = CURRENT_DATE)::bigint,
    (SELECT count(*) FROM public.groups WHERE archived = false)::bigint;
END;
$$;

-- 3. Admin user list with join counts
CREATE OR REPLACE FUNCTION public.get_admin_users(
  p_search  text    DEFAULT NULL,
  p_limit   int     DEFAULT 100,
  p_offset  int     DEFAULT 0
)
RETURNS TABLE (
  id            uuid,
  name          text,
  email         text,
  phone         text,
  avatar_url    text,
  created_at    timestamptz,
  is_admin      boolean,
  group_count   bigint,
  expense_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    u.email,
    p.phone,
    p.avatar_url,
    u.created_at,
    p.is_admin,
    (
      SELECT count(*) FROM public.group_members gm
      WHERE gm.user_id = p.id
    )::bigint AS group_count,
    (
      SELECT count(*) FROM public.expenses e
      JOIN public.group_members gm ON e.paid_by_member_id = gm.id
      WHERE gm.user_id = p.id
    )::bigint AS expense_count
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE (
    p_search IS NULL OR
    p.name    ILIKE '%' || p_search || '%' OR
    u.email   ILIKE '%' || p_search || '%' OR
    p.phone   ILIKE '%' || p_search || '%'
  )
  ORDER BY u.created_at DESC
  LIMIT  p_limit
  OFFSET p_offset;
END;
$$;

-- 4. Admin activity feed: recent expenses across all users
CREATE OR REPLACE FUNCTION public.get_admin_activity(p_limit int DEFAULT 50)
RETURNS TABLE (
  id          uuid,
  type        text,
  description text,
  amount_cents bigint,
  group_name  text,
  user_name   text,
  user_id     uuid,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    'expense'::text AS type,
    e.description,
    e.amount_cents::bigint,
    g.name AS group_name,
    COALESCE(p.name, split_part(u.email, '@', 1)) AS user_name,
    gm.user_id,
    e.created_at
  FROM public.expenses e
  JOIN public.groups       g  ON g.id  = e.group_id
  JOIN public.group_members gm ON gm.id = e.paid_by_member_id
  LEFT JOIN public.profiles  p  ON p.id  = gm.user_id
  LEFT JOIN auth.users       u  ON u.id  = gm.user_id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute to authenticated users (RPC functions enforce their own admin check)
GRANT EXECUTE ON FUNCTION public.get_admin_stats()                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users(text, int, int)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_activity(int)                        TO authenticated;
