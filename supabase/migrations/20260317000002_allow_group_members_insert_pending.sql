-- Allow group members to add pending (contact) members with user_id = null.
-- Previously only policies with user_id = auth.uid() existed, so inserting
-- a contact row (user_id IS NULL) would silently fail RLS and the friend
-- would never appear in the group.

CREATE POLICY "group members can add pending members"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IS NULL
    AND is_group_member(group_id, auth.uid())
  );
