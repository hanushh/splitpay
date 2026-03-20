-- Fix: create_expense_with_splits did not create user_notifications entries,
-- so group members were never notified when a new expense was added.
--
-- Changes:
--   1. Extend create_expense_with_splits to insert a user_notification row for
--      each split member who is a real app user (has a user_id) and is not the
--      actor (the person who added the expense).
--   2. The client is responsible for calling dispatch-push-notifications after
--      a successful expense creation to deliver the pending notifications.

CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id          UUID,
  p_description       TEXT,
  p_amount_cents      INTEGER,
  p_paid_by_member_id UUID,
  p_category          TEXT,
  p_receipt_url       TEXT,
  p_split_member_ids  UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id    UUID;
  v_member_count  INTEGER;
  v_per_person    INTEGER;
  v_remainder     INTEGER;
  v_member_id     UUID;
  v_idx           INTEGER;
  v_split_amount  INTEGER;
  v_user_id       UUID;
  v_payer_user_id UUID;
  v_payer_split   INTEGER := 0;
  v_group_name    TEXT;
  v_actor_name    TEXT;
  v_notif_title   TEXT;
  v_notif_body    TEXT;
BEGIN
  -- Belt-and-suspenders auth check (RLS is also in place)
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- Insert expense
  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url
  ) VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url
  ) RETURNING id INTO v_expense_id;

  -- Split arithmetic
  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;
  v_per_person := p_amount_cents / v_member_count;
  v_remainder  := p_amount_cents - (v_per_person * v_member_count);

  -- Resolve payer's user_id once
  SELECT user_id INTO v_payer_user_id
  FROM public.group_members WHERE id = p_paid_by_member_id;

  -- Fetch group name and payer display name for notifications
  SELECT COALESCE(name, 'a group') INTO v_group_name
  FROM public.groups WHERE id = p_group_id;

  SELECT COALESCE(gm.display_name, p.name, split_part(u.email, '@', 1), 'Someone')
  INTO v_actor_name
  FROM public.group_members gm
  LEFT JOIN auth.users u ON u.id = gm.user_id
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.id = p_paid_by_member_id;

  -- Insert splits + update non-payer balances
  FOR v_idx IN 1 .. v_member_count LOOP
    v_member_id    := p_split_member_ids[v_idx];
    v_split_amount := CASE WHEN v_idx = v_member_count
                          THEN v_per_person + v_remainder
                          ELSE v_per_person END;

    INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
    VALUES (v_expense_id, v_member_id, v_split_amount);

    IF v_member_id = p_paid_by_member_id THEN
      v_payer_split := v_split_amount;   -- remember payer's own share
    ELSE
      -- This member owes the payer: decrease their balance
      SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
      IF v_user_id IS NOT NULL THEN
        INSERT INTO public.group_balances (group_id, user_id, balance_cents)
        VALUES (p_group_id, v_user_id, -v_split_amount)
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET balance_cents = public.group_balances.balance_cents - v_split_amount;
      END IF;
    END IF;
  END LOOP;

  -- Payer's balance increases by (amount paid − their own share)
  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_amount_cents - v_payer_split)
    ON CONFLICT (group_id, user_id) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_payer_split);
  END IF;

  -- Notify all split members who are real users and are not the actor
  FOR v_idx IN 1 .. v_member_count LOOP
    v_member_id := p_split_member_ids[v_idx];

    SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;

    -- Skip: no linked user account, or this is the person who added the expense
    CONTINUE WHEN v_user_id IS NULL OR v_user_id = auth.uid();

    v_split_amount := CASE WHEN v_idx = v_member_count
                          THEN v_per_person + v_remainder
                          ELSE v_per_person END;

    v_notif_title := format('New expense in %s', v_group_name);

    IF v_member_id = p_paid_by_member_id THEN
      -- Payer is being notified (actor != payer, e.g. someone else logged the expense on behalf of payer)
      v_notif_body := format(
        '%s added "%s" ($%.2f) — you paid.',
        v_actor_name,
        p_description,
        p_amount_cents / 100.0
      );
    ELSE
      v_notif_body := format(
        '%s paid $%.2f for "%s" — you owe $%.2f.',
        v_actor_name,
        p_amount_cents / 100.0,
        p_description,
        v_split_amount / 100.0
      );
    END IF;

    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_user_id,
      auth.uid(),
      p_group_id,
      'expense_added',
      v_notif_title,
      v_notif_body,
      jsonb_build_object(
        'expense_id',   v_expense_id,
        'group_id',     p_group_id,
        'group_name',   v_group_name,
        'amount_cents', p_amount_cents
      )
    );
  END LOOP;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[]
) TO authenticated;
