CREATE OR REPLACE FUNCTION public.initialize_demo_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g1_id UUID; g2_id UUID; g3_id UUID; g4_id UUID;
  mu_apt UUID; mu_japan UUID; mu_dinner UUID;
  sarah_apt UUID; sarah_japan UUID; mike_japan UUID;
  alex_dinner UUID; mike_dinner UUID; sarah_dinner UUID;
  e_id UUID;
BEGIN
  SELECT id INTO g1_id FROM groups WHERE name = 'Apartment 4B'   LIMIT 1;
  SELECT id INTO g2_id FROM groups WHERE name = 'Japan Trip 🇯🇵' LIMIT 1;
  SELECT id INTO g3_id FROM groups WHERE name = 'Weekly Dinner'   LIMIT 1;
  SELECT id INTO g4_id FROM groups WHERE name = 'Tahoe Ski Trip'  LIMIT 1;

  -- Add user to all demo groups
  INSERT INTO group_members (group_id, user_id) VALUES
    (g1_id, p_user_id),(g2_id, p_user_id),(g3_id, p_user_id),(g4_id, p_user_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO mu_apt    FROM group_members WHERE group_id = g1_id AND user_id = p_user_id LIMIT 1;
  SELECT id INTO mu_japan  FROM group_members WHERE group_id = g2_id AND user_id = p_user_id LIMIT 1;
  SELECT id INTO mu_dinner FROM group_members WHERE group_id = g3_id AND user_id = p_user_id LIMIT 1;

  -- Demo balances
  INSERT INTO group_balances (group_id, user_id, balance_cents) VALUES
    (g1_id, p_user_id,  4500),(g2_id, p_user_id, 0),(g3_id, p_user_id, -2250),(g4_id, p_user_id, 0)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  -- Skip expense seeding if already done for this user
  IF EXISTS (SELECT 1 FROM expenses WHERE paid_by_member_id = mu_apt) THEN RETURN; END IF;

  -- ─ Apartment 4B members
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g1_id AND display_name = 'Sarah') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g1_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') RETURNING id INTO sarah_apt;
  ELSE
    SELECT id INTO sarah_apt FROM group_members WHERE group_id = g1_id AND display_name = 'Sarah' LIMIT 1;
  END IF;

  -- Groceries & Utilities: You paid 9000, split equally with Sarah
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g1_id, 'Groceries & Utilities', 9000, mu_apt, 'store', NOW() - INTERVAL '5 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_apt, 4500),(e_id, sarah_apt, 4500);

  -- Rent: Sarah paid 150000, split equally
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g1_id, 'Monthly Rent', 150000, sarah_apt, 'other', NOW() - INTERVAL '10 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_apt, 75000),(e_id, sarah_apt, 75000);

  -- ─ Japan Trip members
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g2_id AND display_name = 'Sarah') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g2_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') RETURNING id INTO sarah_japan;
  ELSE
    SELECT id INTO sarah_japan FROM group_members WHERE group_id = g2_id AND display_name = 'Sarah' LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g2_id AND display_name = 'Mike') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g2_id, 'Mike', 'https://i.pravatar.cc/48?img=3') RETURNING id INTO mike_japan;
  ELSE
    SELECT id INTO mike_japan FROM group_members WHERE group_id = g2_id AND display_name = 'Mike' LIMIT 1;
  END IF;

  -- Sushi Dinner: You paid 12000, split 3 ways (4000 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g2_id, 'Sushi Dinner at Ginza', 12000, mu_japan, 'restaurant', NOW() - INTERVAL '2 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_japan, 4000),(e_id, sarah_japan, 4000),(e_id, mike_japan, 4000);

  -- Hotel: Sarah paid 30000, split 3 ways (10000 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g2_id, 'Hotel Stay in Kyoto', 30000, sarah_japan, 'hotel', NOW() - INTERVAL '3 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_japan, 10000),(e_id, sarah_japan, 10000),(e_id, mike_japan, 10000);

  -- Shinkansen: Mike paid 24000, split 3 ways (8000 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g2_id, 'Shinkansen Tickets', 24000, mike_japan, 'train', NOW() - INTERVAL '10 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_japan, 8000),(e_id, sarah_japan, 8000),(e_id, mike_japan, 8000);

  -- 7-Eleven: You paid 4500, split 3 ways (1500 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g2_id, '7-Eleven Snacks', 4500, mu_japan, 'store', NOW() - INTERVAL '15 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_japan, 1500),(e_id, sarah_japan, 1500),(e_id, mike_japan, 1500);

  -- ─ Weekly Dinner members
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g3_id AND display_name = 'Alex') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g3_id, 'Alex', 'https://i.pravatar.cc/48?img=4') RETURNING id INTO alex_dinner;
  ELSE
    SELECT id INTO alex_dinner FROM group_members WHERE group_id = g3_id AND display_name = 'Alex' LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g3_id AND display_name = 'Mike') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g3_id, 'Mike', 'https://i.pravatar.cc/48?img=3') RETURNING id INTO mike_dinner;
  ELSE
    SELECT id INTO mike_dinner FROM group_members WHERE group_id = g3_id AND display_name = 'Mike' LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM group_members WHERE group_id = g3_id AND display_name = 'Sarah') THEN
    INSERT INTO group_members (group_id, display_name, avatar_url)
    VALUES (g3_id, 'Sarah', 'https://i.pravatar.cc/48?img=5') RETURNING id INTO sarah_dinner;
  ELSE
    SELECT id INTO sarah_dinner FROM group_members WHERE group_id = g3_id AND display_name = 'Sarah' LIMIT 1;
  END IF;

  -- Weekly Dinner Thai: Alex paid 9000, split 4 ways (2250 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g3_id, 'Weekly Dinner - Thai', 9000, alex_dinner, 'restaurant', NOW() - INTERVAL '8 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_dinner, 2250),(e_id, alex_dinner, 2250),(e_id, mike_dinner, 2250),(e_id, sarah_dinner, 2250);

  -- Weekly Dinner Italian: You paid 8000, split 4 ways (2000 each)
  INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, category, created_at)
  VALUES (g3_id, 'Weekly Dinner - Italian', 8000, mu_dinner, 'restaurant', NOW() - INTERVAL '15 days')
  RETURNING id INTO e_id;
  INSERT INTO expense_splits (expense_id, member_id, amount_cents) VALUES
    (e_id, mu_dinner, 2000),(e_id, alex_dinner, 2000),(e_id, mike_dinner, 2000),(e_id, sarah_dinner, 2000);

END;
$$;;
