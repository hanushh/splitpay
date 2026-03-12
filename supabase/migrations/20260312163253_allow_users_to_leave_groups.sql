-- Allow users to remove their own membership from a group (leave group).
-- This is needed so users can leave demo groups and groups they no longer want to be part of.
CREATE POLICY "users can leave groups"
  ON public.group_members
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
