-- Restrict group visibility to members only.
--
-- The "creators can read own groups" policy was added to allow the group
-- creation flow to read back the inserted row via .insert().select('id').
-- The client now pre-generates the UUID, so that workaround is no longer
-- needed. Dropping this policy ensures users can only see groups they are
-- actually a member of, preventing group creators from seeing groups after
-- they have left.

DROP POLICY IF EXISTS "creators can read own groups" ON public.groups;
