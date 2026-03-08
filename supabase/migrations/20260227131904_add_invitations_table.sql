-- Invitations: invite a friend by email, optionally to a group
CREATE TABLE IF NOT EXISTS public.invitations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_email    TEXT        NOT NULL,
  group_id         UUID        REFERENCES public.groups(id) ON DELETE CASCADE,
  token            TEXT        NOT NULL UNIQUE,
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON public.invitations(inviter_id);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inviters can manage own invitations"
  ON public.invitations FOR ALL
  USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);

-- Redeem: accept invite and add user to group if group_id set
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token TEXT, p_user_id UUID)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invitation invitations%ROWTYPE;
  v_group_name TEXT;
  v_member_id UUID;
BEGIN
  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.invitations SET status = 'accepted' WHERE id = v_invitation.id;

  IF v_invitation.group_id IS NOT NULL THEN
    -- Ensure user is in group_members
    INSERT INTO public.group_members (group_id, user_id)
    VALUES (v_invitation.group_id, p_user_id)
    ON CONFLICT DO NOTHING;
    -- Get group name
    SELECT name INTO v_group_name FROM public.groups WHERE id = v_invitation.group_id;
    -- Ensure group_balances row exists
    INSERT INTO public.group_balances (group_id, user_id, balance_cents)
    VALUES (v_invitation.group_id, p_user_id, 0)
    ON CONFLICT (group_id, user_id) DO NOTHING;
    group_id_out := v_invitation.group_id;
    group_name_out := v_group_name;
    RETURN NEXT;
  ELSE
    RETURN NEXT;
  END IF;
END;
$$;

-- Allow authenticated user to call redeem (they pass their own user_id via auth.uid())
CREATE OR REPLACE FUNCTION public.redeem_invitation_for_current_user(p_token TEXT)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT group_id_out, group_name_out FROM public.redeem_invitation(p_token, auth.uid());
$$;;
