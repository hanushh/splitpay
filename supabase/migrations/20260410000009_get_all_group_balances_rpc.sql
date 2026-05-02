-- Add an RPC that returns the net balance for every member of a group.
-- group_balances has RLS that only lets a user read their own row, so a
-- direct table query cannot power the group-perspective balances screen.
-- This SECURITY DEFINER function bypasses RLS after verifying the caller is
-- a member of the group.

CREATE OR REPLACE FUNCTION public.get_all_group_balances(p_group_id UUID)
RETURNS TABLE (
  member_id     UUID,
  user_id       UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  currency_code TEXT,
  balance_cents INTEGER
)
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public STABLE AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  RETURN QUERY
  SELECT
    gm.id                                          AS member_id,
    gm.user_id,
    COALESCE(gm.display_name, p.name, 'Unknown')   AS display_name,
    COALESCE(gm.avatar_url, p.avatar_url)          AS avatar_url,
    gb.currency_code,
    COALESCE(gb.balance_cents, 0)                  AS balance_cents
  FROM public.group_members gm
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  LEFT JOIN public.group_balances gb
    ON gb.group_id = gm.group_id AND gb.user_id = gm.user_id
  WHERE gm.group_id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_group_balances TO authenticated;
