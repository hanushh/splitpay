-- Remove all real users (those with a user_id) from the pre-seeded demo groups.
-- Demo groups were seeded as shared fixtures and should not have real user memberships.
-- This cleans up invalid data for users affected by the auto-initialization bug.

DELETE FROM group_members
WHERE user_id IS NOT NULL
  AND group_id IN (
    SELECT id FROM groups
    WHERE name IN ('Apartment 4B', 'Japan Trip 🇯🇵', 'Weekly Dinner', 'Tahoe Ski Trip')
  );

-- Also remove any orphaned group_balances entries for those demo groups for real users.
DELETE FROM group_balances
WHERE user_id IS NOT NULL
  AND group_id IN (
    SELECT id FROM groups
    WHERE name IN ('Apartment 4B', 'Japan Trip 🇯🇵', 'Weekly Dinner', 'Tahoe Ski Trip')
  );
