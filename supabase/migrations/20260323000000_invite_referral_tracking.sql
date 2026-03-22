-- Referral / Invite Rewards Program
-- Tracks who redeemed each invitation so the inviter can see their referral count.

-- 1. Record the redeemer on the invitation row
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS redeemed_by_user_id UUID REFERENCES auth.users(id);

-- 2. Update the user-facing RPC wrapper to stamp the redeemer
CREATE OR REPLACE FUNCTION public.redeem_invitation_for_current_user(p_token TEXT)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_group_id   UUID;
  v_group_name TEXT;
BEGIN
  -- Call the underlying worker (handles member linking + status update)
  SELECT ri.group_id_out, ri.group_name_out
    INTO v_group_id, v_group_name
    FROM public.redeem_invitation(p_token, auth.uid()) ri;

  -- Stamp who redeemed it (idempotent)
  UPDATE public.invitations
     SET redeemed_by_user_id = auth.uid()
   WHERE token = p_token
     AND redeemed_by_user_id IS NULL;

  RETURN QUERY SELECT v_group_id, v_group_name;
END;
$$;

-- 3. RPC: get invite stats for a user (used by Account tab referral badge)
CREATE OR REPLACE FUNCTION public.get_invite_stats(p_user_id UUID)
RETURNS TABLE (
  total_sent     BIGINT,
  total_accepted BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT                                          AS total_sent,
    COUNT(*) FILTER (WHERE status = 'accepted')::BIGINT      AS total_accepted
  FROM public.invitations
  WHERE inviter_id = p_user_id;
$$;
