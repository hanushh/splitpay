-- Allow group members to add other app users (with a real user_id) to the group.
-- Previously only two INSERT policies existed:
--   1. "users can add self to group"   – user_id = auth.uid()
--   2. "group members can add pending members" – user_id IS NULL (contact rows)
-- There was no policy covering user_id = <another_user_id>, so inserting a
-- friend who already has an account would silently fail RLS and the member
-- would never appear in the group after creation.

CREATE POLICY "group members can add other app users"
  ON public.group_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id IS NOT NULL
    AND user_id <> auth.uid()
    AND is_group_member(group_id, auth.uid())
  );
