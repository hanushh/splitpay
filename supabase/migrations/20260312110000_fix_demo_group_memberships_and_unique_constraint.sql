-- Remove ALL real-user memberships from demo groups (groups with created_by IS NULL).
-- These are seeded fixture groups and should never have real user memberships.
DELETE FROM public.group_members
WHERE user_id IS NOT NULL
  AND group_id IN (
    SELECT id FROM public.groups WHERE created_by IS NULL
  );

-- Also remove orphaned balance entries for real users in those groups.
DELETE FROM public.group_balances
WHERE user_id IS NOT NULL
  AND group_id IN (
    SELECT id FROM public.groups WHERE created_by IS NULL
  );

-- Add a partial unique index on (group_id, user_id) for non-null user_id rows
-- to prevent duplicate memberships in the future.
CREATE UNIQUE INDEX IF NOT EXISTS group_members_unique_user
  ON public.group_members (group_id, user_id)
  WHERE user_id IS NOT NULL;
