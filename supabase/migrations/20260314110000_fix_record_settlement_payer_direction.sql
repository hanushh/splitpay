-- Drop the existing 5-param signature so we can add the optional 6th param
DROP FUNCTION IF EXISTS public.record_settlement(UUID, UUID, INTEGER, TEXT, TEXT);

-- New version: accepts optional p_payer_member_id.
-- If NULL → caller (auth.uid()) is the payer (existing behaviour).
-- If provided → caller must be the payee; the provided member is the payer.
CREATE OR REPLACE FUNCTION public.record_settlement(
  p_group_id           UUID,
  p_payee_member_id    UUID,
  p_amount_cents       INTEGER,
  p_payment_method     TEXT    DEFAULT 'cash',
  p_note               TEXT    DEFAULT NULL,
  p_payer_member_id    UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id    UUID;
  v_caller_member_id UUID;
  v_actual_payer_id  UUID;
  v_payer_user_id    UUID;
  v_payee_user_id    UUID;
BEGIN
  -- Resolve caller's membership
  SELECT id INTO v_caller_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  IF p_payer_member_id IS NOT NULL THEN
    -- Caller is recording someone else paying them
    IF p_payee_member_id != v_caller_member_id THEN
      RAISE EXCEPTION 'When specifying a payer, you must be the payee';
    END IF;
    -- Validate the payer belongs to this group
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE id = p_payer_member_id AND group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Payer is not a member of this group';
    END IF;
    v_actual_payer_id := p_payer_member_id;
  ELSE
    -- Caller is the payer; validate payee belongs to this group
    IF NOT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE id = p_payee_member_id AND group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'Payee is not a member of this group';
    END IF;
    v_actual_payer_id := v_caller_member_id;
  END IF;

  SELECT user_id INTO v_payer_user_id FROM public.group_members WHERE id = v_actual_payer_id;
  SELECT user_id INTO v_payee_user_id FROM public.group_members WHERE id = p_payee_member_id;

  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note
  )
  VALUES (
    p_group_id, v_actual_payer_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note
  )
  RETURNING id INTO v_settlement_id;

  -- Payer's balance increases (they paid, owe less / are owed more)
  IF v_payer_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents + p_amount_cents
    WHERE group_id = p_group_id AND user_id = v_payer_user_id;
  END IF;

  -- Payee's balance decreases (they received, owed less / owe more)
  IF v_payee_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - p_amount_cents
    WHERE group_id = p_group_id AND user_id = v_payee_user_id;
  END IF;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_settlement TO authenticated;
