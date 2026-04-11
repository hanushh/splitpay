-- RPCs for member removal, leaving, and group deletion — each inserts
-- user_notifications rows so the client can dispatch push immediately.
--
-- remove_group_member(p_member_id) — creator removes another member
--   → notifies the removed member: "You were removed from '<group>'"
--
-- leave_group(p_group_id) — authenticated user leaves voluntarily
--   → notifies the group creator: "<name> left '<group>'"
--
-- delete_group(p_group_id) — creator deletes the group
--   → notifies all other members: "'<group>' was deleted"
--
-- group_id on user_notifications has ON DELETE SET NULL, so the notification
-- rows survive group deletion and can still be dispatched.

-- ── remove_group_member ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.remove_group_member(p_member_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id     UUID;
  v_member_uid   UUID;
  v_group_name   TEXT;
  v_creator_id   UUID;
BEGIN
  SELECT group_id, user_id INTO v_group_id, v_member_uid
  FROM public.group_members WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  -- Only the group creator may remove other members
  SELECT created_by INTO v_creator_id FROM public.groups WHERE id = v_group_id;
  IF v_creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the group creator can remove members';
  END IF;

  -- Cannot remove yourself via this RPC (use leave_group instead)
  IF v_member_uid = auth.uid() THEN
    RAISE EXCEPTION 'Use leave_group to remove yourself';
  END IF;

  SELECT COALESCE(name, 'a group') INTO v_group_name
  FROM public.groups WHERE id = v_group_id;

  -- Notify the removed member (if they are an app user)
  IF v_member_uid IS NOT NULL THEN
    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_member_uid,
      auth.uid(),
      v_group_id,
      'member_removed',
      'You were removed from a group',
      format('You were removed from "%s".', v_group_name),
      jsonb_build_object('group_id', v_group_id, 'group_name', v_group_name)
    );
  END IF;

  DELETE FROM public.group_members WHERE id = p_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_group_member(UUID) TO authenticated;


-- ── leave_group ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leave_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id    UUID;
  v_creator_id   UUID;
  v_group_name   TEXT;
  v_leaver_name  TEXT;
BEGIN
  SELECT id INTO v_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  SELECT created_by, COALESCE(name, 'a group')
  INTO v_creator_id, v_group_name
  FROM public.groups WHERE id = p_group_id;

  SELECT COALESCE(p.name, split_part(u.email, '@', 1), 'Someone')
  INTO v_leaver_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = auth.uid();

  -- Notify the group creator (if they are not the one leaving)
  IF v_creator_id IS NOT NULL AND v_creator_id <> auth.uid() THEN
    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_creator_id,
      auth.uid(),
      p_group_id,
      'member_left',
      'A member left your group',
      format('%s left "%s".', v_leaver_name, v_group_name),
      jsonb_build_object('group_id', p_group_id, 'group_name', v_group_name)
    );
  END IF;

  DELETE FROM public.group_members WHERE id = v_member_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_group(UUID) TO authenticated;


-- ── delete_group ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id  UUID;
  v_group_name  TEXT;
  v_actor_name  TEXT;
  v_notif_rec   RECORD;
BEGIN
  SELECT created_by, COALESCE(name, 'a group')
  INTO v_creator_id, v_group_name
  FROM public.groups WHERE id = p_group_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the group creator can delete this group';
  END IF;

  SELECT COALESCE(p.name, split_part(u.email, '@', 1), 'Someone')
  INTO v_actor_name
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = auth.uid();

  -- Notify all other members before deletion.
  -- group_id has ON DELETE SET NULL so these rows survive after the group is gone.
  FOR v_notif_rec IN
    SELECT user_id FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id IS NOT NULL
      AND user_id <> auth.uid()
  LOOP
    INSERT INTO public.user_notifications (
      user_id, actor_user_id, group_id, type, title, body, metadata
    ) VALUES (
      v_notif_rec.user_id,
      auth.uid(),
      p_group_id,
      'group_deleted',
      'A group was deleted',
      format('%s deleted "%s".', v_actor_name, v_group_name),
      jsonb_build_object('group_name', v_group_name)
    );
  END LOOP;

  DELETE FROM public.groups WHERE id = p_group_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_group(UUID) TO authenticated;
