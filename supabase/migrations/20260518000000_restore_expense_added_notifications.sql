-- Restore push notifications when a new expense is added.
--
-- create_expense_with_splits used to insert one user_notifications row per
-- non-actor splittee (see 20260320000000_expense_notifications.sql), but the
-- function was rewritten in 20260320000001 (custom splits) and 20260320000002
-- (currency) without preserving that block, so group members have been silently
-- missing every "new expense" push since.  The dispatch pipeline
-- (dispatch-push-notifications edge fn + cron flusher) is unchanged — it just
-- has nothing to send.  20260410000003 already restored the same pattern for
-- update_expense_with_splits and delete_expense; this migration applies the
-- equivalent to the 9-arg currency-aware create_expense_with_splits.
--
-- Body wording matches record_settlement (post-20260410000005 fix), using
-- to_char() rather than the invalid %.2f format specifier.

CREATE OR REPLACE FUNCTION public.create_expense_with_splits(
  p_group_id            UUID,
  p_description         TEXT,
  p_amount_cents        INTEGER,
  p_paid_by_member_id   UUID,
  p_category            TEXT,
  p_receipt_url         TEXT,
  p_split_member_ids    UUID[],
  p_split_amounts_cents INTEGER[] DEFAULT NULL,
  p_currency_code       TEXT      DEFAULT 'INR'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id      UUID;
  v_member_count    INTEGER;
  v_per_person      INTEGER;
  v_remainder       INTEGER;
  v_member_id       UUID;
  v_idx             INTEGER;
  v_split_amount    INTEGER;
  v_user_id         UUID;
  v_payer_user_id   UUID;
  v_payer_split     INTEGER := 0;
  v_group_name      TEXT;
  v_actor_name      TEXT;
  v_notif_rec       RECORD;
BEGIN
  IF NOT public.is_group_member(p_group_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  INSERT INTO public.expenses (
    group_id, description, amount_cents, paid_by_member_id, category, receipt_url, currency_code
  )
  VALUES (
    p_group_id, p_description, p_amount_cents, p_paid_by_member_id, p_category, p_receipt_url, p_currency_code
  )
  RETURNING id INTO v_expense_id;

  v_member_count := array_length(p_split_member_ids, 1);
  IF v_member_count IS NULL OR v_member_count = 0 THEN
    RAISE EXCEPTION 'At least one split member is required';
  END IF;

  SELECT user_id INTO v_payer_user_id
  FROM public.group_members WHERE id = p_paid_by_member_id;

  IF p_split_amounts_cents IS NOT NULL THEN
    IF array_length(p_split_amounts_cents, 1) <> v_member_count THEN
      RAISE EXCEPTION 'split_amounts_cents length must match split_member_ids length';
    END IF;
    IF (SELECT SUM(x) FROM unnest(p_split_amounts_cents) AS x) <> p_amount_cents THEN
      RAISE EXCEPTION 'Split amounts must sum to the total expense amount';
    END IF;
    FOR v_idx IN 1 .. v_member_count LOOP
      v_member_id    := p_split_member_ids[v_idx];
      v_split_amount := p_split_amounts_cents[v_idx];

      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (v_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (p_group_id, v_user_id, p_currency_code, -v_split_amount)
          ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
            SET balance_cents = public.group_balances.balance_cents - v_split_amount;
        END IF;
      END IF;
    END LOOP;
  ELSE
    v_per_person := p_amount_cents / v_member_count;
    v_remainder  := p_amount_cents - (v_per_person * v_member_count);
    FOR v_idx IN 1 .. v_member_count LOOP
      v_member_id    := p_split_member_ids[v_idx];
      v_split_amount := CASE WHEN v_idx = v_member_count
                             THEN v_per_person + v_remainder
                             ELSE v_per_person END;

      INSERT INTO public.expense_splits (expense_id, member_id, amount_cents)
      VALUES (v_expense_id, v_member_id, v_split_amount);

      IF v_member_id = p_paid_by_member_id THEN
        v_payer_split := v_split_amount;
      ELSE
        SELECT user_id INTO v_user_id FROM public.group_members WHERE id = v_member_id;
        IF v_user_id IS NOT NULL THEN
          INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
          VALUES (p_group_id, v_user_id, p_currency_code, -v_split_amount)
          ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
            SET balance_cents = public.group_balances.balance_cents - v_split_amount;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_currency_code, p_amount_cents - v_payer_split)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + (p_amount_cents - v_payer_split);
  END IF;

  -- ── Notify splittees about the new expense ────────────────────────────────

  SELECT COALESCE(name, 'a group') INTO v_group_name
  FROM public.groups WHERE id = p_group_id;

  SELECT COALESCE(gm.display_name, p.name, split_part(u.email, '@', 1), 'Someone')
  INTO v_actor_name
  FROM public.group_members gm
  LEFT JOIN auth.users u ON u.id = gm.user_id
  LEFT JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.id = p_paid_by_member_id;

  FOR v_notif_rec IN
    SELECT gm.user_id, es.amount_cents AS split_cents, gm.id AS member_id
    FROM public.expense_splits es
    JOIN public.group_members gm ON gm.id = es.member_id
    WHERE es.expense_id = v_expense_id
      AND gm.user_id IS NOT NULL
      AND gm.user_id <> auth.uid()
  LOOP
    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_notif_rec.user_id,
      auth.uid(),
      p_group_id,
      'expense_added',
      format('New expense in %s', v_group_name),
      CASE
        WHEN v_notif_rec.member_id = p_paid_by_member_id THEN
          format(
            '%s added "%s" (%s%s) — you paid.',
            v_actor_name,
            p_description,
            p_currency_code || ' ',
            to_char(p_amount_cents / 100.0, 'FM999999990.00')
          )
        ELSE
          format(
            '%s paid %s%s for "%s" — you owe %s%s.',
            v_actor_name,
            p_currency_code || ' ',
            to_char(p_amount_cents / 100.0, 'FM999999990.00'),
            p_description,
            p_currency_code || ' ',
            to_char(v_notif_rec.split_cents / 100.0, 'FM999999990.00')
          )
      END,
      jsonb_build_object(
        'expense_id',    v_expense_id,
        'group_id',      p_group_id,
        'group_name',    v_group_name,
        'amount_cents',  p_amount_cents,
        'currency_code', p_currency_code
      )
    );
  END LOOP;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_with_splits(
  UUID, TEXT, INTEGER, UUID, TEXT, TEXT, UUID[], INTEGER[], TEXT
) TO authenticated;
