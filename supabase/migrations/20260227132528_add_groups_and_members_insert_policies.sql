-- Allow authenticated users to create groups (and set themselves as creator)
CREATE POLICY "authenticated can create groups"
  ON public.groups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Allow users to add themselves to a group (e.g. when creating a group or when redeeming an invite is done via SECURITY DEFINER)
CREATE POLICY "users can add self to group"
  ON public.group_members FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
;
