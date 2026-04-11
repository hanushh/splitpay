-- Fix infinite recursion in group_members and groups RLS policies.
-- The original policies in 20260227105559 used self-referential subqueries on
-- group_members which cause "infinite recursion detected in policy" errors.
-- Replace both with the SECURITY DEFINER is_group_member() function which
-- bypasses RLS when checking membership, breaking the recursion.

DROP POLICY IF EXISTS "members can read group_members" ON public.group_members;
CREATE POLICY "members can read group_members" ON public.group_members
  FOR SELECT TO authenticated
  USING (is_group_member(group_id, auth.uid()));

DROP POLICY IF EXISTS "members can read groups" ON public.groups;
CREATE POLICY "members can read groups" ON public.groups
  FOR SELECT TO authenticated
  USING (is_group_member(id, auth.uid()));
