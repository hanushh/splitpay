-- Seed external (non-auth) mock members for the mock groups
DO $$
DECLARE
  g1_id UUID;
  g2_id UUID;
  g3_id UUID;
BEGIN
  SELECT id INTO g1_id FROM groups WHERE name = 'Apartment 4B' LIMIT 1;
  SELECT id INTO g2_id FROM groups WHERE name = 'Japan Trip 🇯🇵' LIMIT 1;
  SELECT id INTO g3_id FROM groups WHERE name = 'Weekly Dinner' LIMIT 1;

  -- Apartment 4B members
  INSERT INTO group_members (group_id, display_name, avatar_url) VALUES
    (g1_id, 'Alex', 'https://lh3.googleusercontent.com/aida-public/AB6AXuCbozyyKXpfYUS8iRfCQj1YA-ppeegXfwG9PlEYofqA6sAei6K-H25H3_Ung5VUDewO5L0iZQ7mpN3Pkq6-NDQv6aDbIqib-hJCSvatjbXofGYJV0POrKUjHWEQifx3qo3b1gmgF5v-962hx-tTqzk_yFySOdX-HMulOkVWDEx7r927xr0H4iHqpbojCNDvxRBdD2TC9o1a4-KJcTELY3QqcCVVISkWfDAIWhYu18Ndpd9F1lkWd9064CKhQIHuqbt-u6iVfIiO'),
    (g1_id, 'Sam',  'https://lh3.googleusercontent.com/aida-public/AB6AXuBuRSoGuNppS0_mKdiJKXAoalEiCEvFygOaN8pYFVbtCdMQYLRMWXlnAVuiioZvR8T3Zpat-90n-NlwIX93hPHizLFrfdLPttCwfEh40p4gtZxngHzwiYvd7Wi3pGTia6UyXevqt46KIas-RFzM5ObQ4I2-4TSxvOpQb-iOkUE0I8SXELrapkEEByJDl9uyaphA0pNRCxsb0J7mxiAY4ezUPuzdVvBPzGAUrXDfJ2Q-o4-x-V3X7jPtk-das_y3gTr1csrzdBsk');

  -- Weekly Dinner members
  INSERT INTO group_members (group_id, display_name, avatar_url) VALUES
    (g3_id, 'Jordan', 'https://lh3.googleusercontent.com/aida-public/AB6AXuB1EX9gzM9spJnmRDBX_8ddVCRuV8DnrNcpxMpFeNOJlFWDkjfNW3k80AOCg9vReJNhtYgmQwDOxy0FGTSezjdPtXLW1uNnPNuoIQgW31enjN8t-8Xwkk0oCLo6YUNEpe1QXT-xRi7cXqTFs0r3rG34yzj6aILtUXRWOu3kAVP6NLm9fhV0WKoIthC4jA9gdlQRGxgxFLav1xHgnlgIYG5hW4qVc268y0tB5jGSzNSvVDU37DtAhp3-G7EAAg_OXsi72OQE0r62'),
    (g3_id, 'Taylor','https://lh3.googleusercontent.com/aida-public/AB6AXuBjsKyzrgtP0ldQtNH5uCr78j1gcIXz3Qa5PVPWWvkjXlb7wu58l0YnDJo3qoQ2kt9zQnZe3FYy2Q2Z9e4GbCjQYn36c-8zhO6VuRkM8DF4f4bqBocwmbZMSFnOR2zyRuCc2F2KSluw89YzV4uS5k1C0pjklR4pKXbHfdQqw38AOI8fv6K2FZnVS2IwZmh3CU_PhSXdTvhC-oRy6YkJgyrlwGIJ69eTBeoTMbTPLB9uutvRC60mvTu0bA3_lN1pQHV4qmC_QQAn'),
    (g3_id, 'Morgan','https://lh3.googleusercontent.com/aida-public/AB6AXuCeGh1ZnfR_vpXVsc1-PNjmGUECxZg4RwFXtmKj6qyCIXzbmIR3UzNEBvCKNgcCgiAjLDt3I_GcqAnGRkBgXDW9P_FYOYRlVUpFfjBGEuX7m-ZwA4OFPcIC9Tx9Fbz0u1mZ4buKAW7qY6NrPYWOKyKnYWFBeIZY_lqhgdDRlUsUgWo8lqtnANWyzgQ4QlhJBnqFqhHRndf7p2lCBS5T7ZLzcJpyGr1BWDP70Prot2F7KZC0To4Ydg4lFHzXXA15HElXxoa9A48w');
END;
$$;

-- Function: called once per user to join them into the demo groups with mock balances
CREATE OR REPLACE FUNCTION initialize_demo_data(p_user_id UUID)
RETURNS VOID LANGUAGE PLPGSQL SECURITY DEFINER AS $$
DECLARE
  g1_id UUID;
  g2_id UUID;
  g3_id UUID;
  g4_id UUID;
BEGIN
  SELECT id INTO g1_id FROM groups WHERE name = 'Apartment 4B'   LIMIT 1;
  SELECT id INTO g2_id FROM groups WHERE name = 'Japan Trip 🇯🇵' LIMIT 1;
  SELECT id INTO g3_id FROM groups WHERE name = 'Weekly Dinner'   LIMIT 1;
  SELECT id INTO g4_id FROM groups WHERE name = 'Tahoe Ski Trip'  LIMIT 1;

  -- Add user as member of every demo group
  INSERT INTO group_members (group_id, user_id) VALUES
    (g1_id, p_user_id),
    (g2_id, p_user_id),
    (g3_id, p_user_id),
    (g4_id, p_user_id)
  ON CONFLICT DO NOTHING;

  -- Set demo balances (cents)
  -- +4500 = owed $45, 0 = settled, -2250 = owes $22.50
  INSERT INTO group_balances (group_id, user_id, balance_cents) VALUES
    (g1_id, p_user_id,  4500),
    (g2_id, p_user_id,     0),
    (g3_id, p_user_id, -2250),
    (g4_id, p_user_id,     0)
  ON CONFLICT (group_id, user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION initialize_demo_data(UUID) TO authenticated;;
