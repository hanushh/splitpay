-- Notify the inviter when someone accepts their group invite.
--
-- Rewrites redeem_invitation (plpgsql) to insert a user_notifications row
-- for the inviter after the new member joins. The client (_layout.tsx) calls
-- dispatchPendingPushNotifications() after redeem_invitation_for_current_user
-- succeeds, so the push is delivered immediately.

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token TEXT, p_user_id UUID)
RETURNS TABLE (group_id_out UUID, group_name_out TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invitation  invitations%ROWTYPE;
  v_group_name  TEXT;
  v_joiner_name TEXT;
BEGIN
  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.invitations SET status = 'accepted' WHERE id = v_invitation.id;

  IF v_invitation.group_id IS NOT NULL THEN
    -- Add the user to the group (idempotent)
    INSERT INTO public.group_members (group_id, user_id)
    VALUES (v_invitation.group_id, p_user_id)
    ON CONFLICT DO NOTHING;

    -- Ensure a balance row exists
    INSERT INTO public.group_balances (group_id, user_id, balance_cents)
    VALUES (v_invitation.group_id, p_user_id, 0)
    ON CONFLICT (group_id, user_id) DO NOTHING;

    SELECT name INTO v_group_name FROM public.groups WHERE id = v_invitation.group_id;

    -- Resolve the joiner's display name
    SELECT COALESCE(p.name, split_part(u.email, '@', 1), 'Someone')
    INTO v_joiner_name
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_user_id;

    -- Notify the inviter (skip if the inviter is the one redeeming — shouldn't
    -- happen, but guard anyway)
    IF v_invitation.inviter_id IS NOT NULL AND v_invitation.inviter_id <> p_user_id THEN
      INSERT INTO public.user_notifications (
        user_id, actor_user_id, group_id, type, title, body, metadata
      ) VALUES (
        v_invitation.inviter_id,
        p_user_id,
        v_invitation.group_id,
        'member_joined',
        'Someone joined your group',
        format('%s joined "%s".', v_joiner_name, v_group_name),
        jsonb_build_object(
          'group_id',   v_invitation.group_id,
          'group_name', v_group_name,
          'joiner_id',  p_user_id
        )
      );
    END IF;

    group_id_out  := v_invitation.group_id;
    group_name_out := v_group_name;
    RETURN NEXT;
  ELSE
    RETURN NEXT;
  END IF;
END;
$$;
