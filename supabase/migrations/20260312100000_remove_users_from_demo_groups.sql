-- Remove real users from demo groups
-- This cleans up existing users who were auto-joined to demo groups via initialize_demo_data
DO $$
DECLARE
  demo_group_ids UUID[];
BEGIN
  SELECT ARRAY(
    SELECT id FROM groups
    WHERE name IN ('Apartment 4B', 'Japan Trip 🇯🇵', 'Weekly Dinner', 'Tahoe Ski Trip')
  ) INTO demo_group_ids;

  -- Remove balance records for real users in demo groups
  DELETE FROM group_balances
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;

  -- Remove real user memberships from demo groups
  DELETE FROM group_members
  WHERE group_id = ANY(demo_group_ids)
    AND user_id IS NOT NULL;
END;
$$;
