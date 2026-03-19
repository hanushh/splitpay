-- Allow authenticated users to read profiles of other users who share a group with them.
-- Without this, the group detail screen cannot resolve member names for app users.
CREATE POLICY "users can read groupmate profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM group_members gm1
      JOIN group_members gm2 ON gm1.group_id = gm2.group_id
      WHERE gm1.user_id = auth.uid()
        AND gm2.user_id = profiles.id
    )
  );
