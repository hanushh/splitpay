CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token TEXT, p_user_id UUID)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
  v_group_name TEXT;
BEGIN
  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.invitations SET status = 'accepted' WHERE id = v_invitation.id;

  IF v_invitation.group_id IS NOT NULL THEN
    INSERT INTO public.group_members (group_id, user_id)
    SELECT v_invitation.group_id, p_user_id
    WHERE NOT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = v_invitation.group_id AND user_id = p_user_id);
    SELECT name INTO v_group_name FROM public.groups WHERE id = v_invitation.group_id;
    INSERT INTO public.group_balances (group_id, user_id, balance_cents)
    SELECT v_invitation.group_id, p_user_id, 0
    WHERE NOT EXISTS (SELECT 1 FROM public.group_balances WHERE group_id = v_invitation.group_id AND user_id = p_user_id);
    group_id_out := v_invitation.group_id;
    group_name_out := v_group_name;
    RETURN NEXT;
  ELSE
    RETURN NEXT;
  END IF;
END;
$$;
;
