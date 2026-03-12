-- Migration: Remove real users from demo groups
-- Context: initialize_demo_data() was called on every app mount, joining real users
-- into the pre-seeded demo groups. This migration detaches them and removes orphaned
-- balance records so affected users start with a clean state.

DO $$
DECLARE
  demo_group_ids UUID[];
BEGIN
  -- Collect IDs of all demo groups
  SELECT ARRAY_AGG(id) INTO demo_group_ids
  FROM groups
  WHERE name IN ('Apartment 4B', 'Japan Trip 🇯🇵', 'Weekly Dinner', 'Tahoe Ski Trip');

  IF demo_group_ids IS NULL OR array_length(demo_group_ids, 1) = 0 THEN
    RAISE NOTICE 'No demo groups found – nothing to clean up.';
    RETURN;
  END IF;

  -- Remove group_balances for real users in demo groups
  DELETE FROM group_balances
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;

  -- Remove group_members rows for real users in demo groups
  -- (leaves the external/mock members whose user_id IS NULL)
  DELETE FROM group_members
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;

  RAISE NOTICE 'Cleaned up real-user memberships and balances from % demo group(s).', array_length(demo_group_ids, 1);
END;
$$;
