-- Migration: Remove real users from demo groups
-- Demo groups were automatically created at signup and polluted new users' data.
-- This cleans up existing affected users by removing their memberships and balances.

DO $$
DECLARE
  demo_group_ids UUID[];
BEGIN
  -- Collect IDs of the 4 known demo groups
  SELECT ARRAY(
    SELECT id FROM groups
    WHERE name IN ('Apartment 4B', 'Japan Trip 🇯🇵', 'Weekly Dinner', 'Tahoe Ski Trip')
  ) INTO demo_group_ids;

  -- Remove balances for real users (user_id IS NOT NULL) in demo groups
  DELETE FROM group_balances
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;

  -- Remove memberships for real users (user_id IS NOT NULL) in demo groups
  DELETE FROM group_members
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;
END;
$$;
