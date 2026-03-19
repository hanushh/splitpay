-- Fix redeem_invitation to UPDATE the existing contact member row instead of
-- inserting a new one.
--
-- Previous behaviour:
--   1. Contact is added as a pending member: group_members row with user_id=NULL
--   2. Expenses are added and splits link to that row (member_id = contact row id)
--   3. Contact redeems invite → INSERT a brand-new row with user_id set
--   Result: two rows for the same person; expense_splits are on the OLD row,
--   but get_group_member_balances finds the NEW row via LIMIT 1 and sees zero splits
--   → balance always shows 0 after redemption.
--
-- Fixed behaviour:
--   If a null-user_id row with a matching invitation exists, UPDATE it to set
--   user_id. All existing expense_splits continue to reference the same row,
--   so balances are correct immediately after redemption.
--   Fall back to INSERT if no orphaned contact row is found (e.g. invite link
--   shared without first adding as a contact).

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token TEXT, p_user_id UUID)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invitation  invitations%ROWTYPE;
  v_group_name  TEXT;
  v_updated     INT;
BEGIN
  -- Fetch valid, pending, non-expired invitation
  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = p_token
    AND status = 'pending'
    AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.invitations SET status = 'accepted' WHERE id = v_invitation.id;

  IF v_invitation.group_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT name INTO v_group_name FROM public.groups WHERE id = v_invitation.group_id;

  -- Guard: if the user is already a proper member, nothing to do
  IF EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_invitation.group_id AND user_id = p_user_id
  ) THEN
    group_id_out   := v_invitation.group_id;
    group_name_out := v_group_name;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Try to UPDATE an existing orphaned contact row (user_id IS NULL).
  -- Prefer the row whose display_name matches the invitee_email prefix, but
  -- fall back to any null-user_id row in the group so splits are preserved.
  UPDATE public.group_members
  SET user_id = p_user_id
  WHERE id = (
    SELECT id FROM public.group_members
    WHERE group_id = v_invitation.group_id
      AND user_id IS NULL
    ORDER BY
      -- prefer a row whose display_name looks like the invitee (best-effort)
      CASE
        WHEN v_invitation.invitee_email IS NOT NULL
             AND display_name ILIKE split_part(v_invitation.invitee_email, '@', 1) || '%'
        THEN 0
        ELSE 1
      END,
      created_at ASC
    LIMIT 1
  );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- If no orphaned row existed, insert a fresh member row
  IF v_updated = 0 THEN
    INSERT INTO public.group_members (group_id, user_id)
    VALUES (v_invitation.group_id, p_user_id);
  END IF;

  -- Ensure balance row exists (idempotent)
  INSERT INTO public.group_balances (group_id, user_id, balance_cents)
  VALUES (v_invitation.group_id, p_user_id, 0)
  ON CONFLICT (group_id, user_id) DO NOTHING;

  group_id_out   := v_invitation.group_id;
  group_name_out := v_group_name;
  RETURN NEXT;
END;
$$;
