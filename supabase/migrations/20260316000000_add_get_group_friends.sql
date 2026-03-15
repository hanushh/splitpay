-- Returns all users who share at least one group with the caller,
-- regardless of whether they have any expense splits.
-- Used by the Friends tab to surface email-invited users who have joined
-- but haven't yet been involved in any expenses.
CREATE OR REPLACE FUNCTION public.get_group_friends(p_user_id UUID)
RETURNS TABLE (
  user_id    UUID,
  name       TEXT,
  avatar_url TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT DISTINCT
    gm.user_id,
    p.name,
    p.avatar_url
  FROM public.group_members my_gm
  JOIN public.group_members gm
    ON gm.group_id = my_gm.group_id
   AND gm.user_id IS NOT NULL
   AND gm.user_id <> p_user_id
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE my_gm.user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_friends(UUID) TO authenticated;
