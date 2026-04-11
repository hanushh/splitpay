-- Allow group creators to remove other members from their group.
-- Existing RLS only permits users to delete their own row (leave group).
-- This adds a second DELETE policy so the creator can evict any member.

CREATE POLICY "group_creators_can_remove_members"
  ON public.group_members
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups
      WHERE id = group_members.group_id
        AND created_by = auth.uid()
    )
  );
