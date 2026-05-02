-- Allow any group member to record a settlement between any two other members.
-- Previously the caller had to be the payee when specifying an explicit payer;
-- now any authenticated group member can act as a recorder.

CREATE OR REPLACE FUNCTION public.record_settlement(
  p_group_id           UUID,
  p_payee_member_id    UUID,
  p_amount_cents       INTEGER,
  p_payment_method     TEXT DEFAULT 'cash',
  p_note               TEXT DEFAULT NULL,
  p_payer_member_id    UUID DEFAULT NULL,
  p_currency_code      TEXT DEFAULT 'INR'
)
RETURNS UUID
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id    UUID;
  v_caller_member_id UUID;
  v_actual_payer_id  UUID;
  v_payer_user_id    UUID;
  v_payee_user_id    UUID;
  v_group_name       TEXT;
  v_payer_name       TEXT;
BEGIN
  -- Caller must be a member of the group (as recorder, payer, or payee)
  SELECT id INTO v_caller_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  IF p_payer_member_id IS NOT NULL THEN
    -- Explicit payer provided: verify they are a group member
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE id = p_payer_member_id AND group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Payer is not a member of this group';
    END IF;
    v_actual_payer_id := p_payer_member_id;
  ELSE
    -- No explicit payer: current user is the payer
    v_actual_payer_id := v_caller_member_id;
  END IF;

  -- Verify payee is a group member
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE id = p_payee_member_id AND group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'Payee is not a member of this group';
  END IF;

  SELECT user_id INTO v_payer_user_id FROM public.group_members WHERE id = v_actual_payer_id;
  SELECT user_id INTO v_payee_user_id FROM public.group_members WHERE id = p_payee_member_id;

  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note, currency_code
  )
  VALUES (
    p_group_id, v_actual_payer_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note, p_currency_code
  )
  RETURNING id INTO v_settlement_id;

  -- Payer's balance increases (they paid, owe less / are owed more)
  IF v_payer_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payer_user_id, p_currency_code, p_amount_cents)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents + p_amount_cents;
  END IF;

  -- Payee's balance decreases (they received, owed less / owe more)
  IF v_payee_user_id IS NOT NULL THEN
    INSERT INTO public.group_balances (group_id, user_id, currency_code, balance_cents)
    VALUES (p_group_id, v_payee_user_id, p_currency_code, -p_amount_cents)
    ON CONFLICT (group_id, user_id, currency_code) DO UPDATE
      SET balance_cents = public.group_balances.balance_cents - p_amount_cents;
  END IF;

  -- Notify the payee that they received a payment
  IF v_payee_user_id IS NOT NULL AND v_payee_user_id != auth.uid() THEN
    SELECT COALESCE(name, 'a group') INTO v_group_name
    FROM public.groups WHERE id = p_group_id;

    SELECT COALESCE(gm.display_name, p.name, split_part(u.email, '@', 1), 'Someone')
    INTO v_payer_name
    FROM public.group_members gm
    LEFT JOIN auth.users u ON u.id = gm.user_id
    LEFT JOIN public.profiles p ON p.id = gm.user_id
    WHERE gm.id = v_actual_payer_id;

    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_payee_user_id,
      auth.uid(),
      p_group_id,
      'settlement_received',
      'You received a payment',
      format(
        '%s paid you %s%s in %s.',
        v_payer_name,
        p_currency_code || ' ',
        to_char(p_amount_cents / 100.0, 'FM999999990.00'),
        v_group_name
      ),
      jsonb_build_object(
        'settlement_id', v_settlement_id,
        'group_id',      p_group_id,
        'group_name',    v_group_name,
        'amount_cents',  p_amount_cents,
        'currency_code', p_currency_code
      )
    );
  END IF;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_settlement TO authenticated;
