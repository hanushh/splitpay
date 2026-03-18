import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemberSearchPicker, type MemberSelection } from '@/components/MemberSearchPicker';
import { useAuth } from '@/context/auth';
import { APP_DISPLAY_NAME, INVITE_LINK_PREFIX, INVITE_WEB_LINK_BASE } from '@/lib/app-config';
import { dispatchPendingPushNotifications } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  orange: '#f97316',
};

function generateToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function InviteFriendScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string; groupName: string }>();

  const [existingMemberIds, setExistingMemberIds] = useState<string[]>([]);
  const [memberSelection, setMemberSelection] = useState<MemberSelection>({ appUsers: [], contacts: [] });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success state
  const [sent, setSent] = useState(false);
  const [addedUsersCount, setAddedUsersCount] = useState(0);
  const [pendingInvites, setPendingInvites] = useState<{ contactName: string; shareUrl: string }[]>([]);

  const loadExistingMembers = useCallback(async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .not('user_id', 'is', null);
    setExistingMemberIds(
      ((data ?? []) as { user_id: string }[]).map((r) => r.user_id).filter(Boolean)
    );
  }, [groupId]);

  useEffect(() => { loadExistingMembers(); }, [loadExistingMembers]);

  const canSend = memberSelection.appUsers.length > 0 || memberSelection.contacts.length > 0;

  const handleSend = async () => {
    if (!canSend || !user || !groupId) return;
    setError(null);
    setSending(true);

    let addedCount = 0;

    // Add app users directly
    if (memberSelection.appUsers.length > 0) {
      const { data: addData, error: addErr } = await supabase.rpc('add_group_members_by_ids', {
        p_group_id: groupId,
        p_user_ids: memberSelection.appUsers.map((u) => u.userId),
      });
      if (addErr) {
        setError(addErr.message ?? 'Failed to add selected users.');
        setSending(false);
        return;
      }
      addedCount = Number(addData ?? 0);
      if (addedCount > 0) {
        await dispatchPendingPushNotifications();
      }
    }

    // Add contacts as pending members + create invitation tokens
    const invites: { contactName: string; shareUrl: string }[] = [];
    for (const contact of memberSelection.contacts) {
      const token = generateToken();
      const inviteeEmail = contact.emails[0] ?? null;

      const { error: memberErr } = await supabase.from('group_members').insert({
        group_id: groupId,
        user_id: null,
        display_name: contact.name,
      });

      if (memberErr) {
        setError(memberErr.message ?? 'Failed to add contact to group.');
        setSending(false);
        return;
      }

      const { error: inviteErr } = await supabase.from('invitations').insert({
        inviter_id: user.id,
        invitee_email: inviteeEmail,
        group_id: groupId,
        token,
        status: 'pending',
      });

      if (!inviteErr) {
        const linkBase = INVITE_WEB_LINK_BASE || INVITE_LINK_PREFIX;
        invites.push({
          contactName: contact.name,
          shareUrl: `${linkBase}?token=${encodeURIComponent(token)}`,
        });
      }
    }

    setAddedUsersCount(addedCount);
    setPendingInvites(invites);
    setSent(true);
    setSending(false);
  };

  const handleShare = async () => {
    if (pendingInvites.length === 0) return;
    try {
      if (pendingInvites.length === 1) {
        await Share.share({
          message: `Hey ${pendingInvites[0].contactName}! Join ${groupName ?? 'our group'} on ${APP_DISPLAY_NAME}: ${pendingInvites[0].shareUrl}`,
        });
      } else {
        const links = pendingInvites.map((p) => `${p.contactName}: ${p.shareUrl}`).join('\n');
        await Share.share({
          message: `Join ${groupName ?? 'our group'} on ${APP_DISPLAY_NAME}!\n${links}`,
        });
      }
    } catch {}
  };

  const sentTitle = (() => {
    if (addedUsersCount > 0 && pendingInvites.length > 0) {
      return `Added ${addedUsersCount} member${addedUsersCount === 1 ? '' : 's'} & created ${pendingInvites.length} invite${pendingInvites.length === 1 ? '' : 's'}`;
    }
    if (addedUsersCount > 0) {
      return `Added ${addedUsersCount} member${addedUsersCount === 1 ? '' : 's'} to "${groupName}"`;
    }
    return `Invite link${pendingInvites.length === 1 ? '' : 's'} created for ${pendingInvites.map((p) => p.contactName).join(', ')}`;
  })();

  const sentSub = pendingInvites.length > 0
    ? `Share the invite link${pendingInvites.length === 1 ? '' : 's'} so they can join "${groupName}".`
    : `They've been added to "${groupName}".`;

  if (sent) {
    return (
      <KeyboardAvoidingView
        style={[s.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn}>
            <Text style={s.cancelText}>Done</Text>
          </Pressable>
          <Text style={s.headerTitle}>Members added</Text>
          <View style={s.headerBtn} />
        </View>
        <View style={s.sentBody}>
          <View style={s.sentIcon}>
            <MaterialIcons name="check-circle" size={64} color={C.primary} />
          </View>
          <Text style={s.sentTitle}>{sentTitle}</Text>
          <Text style={s.sentSub}>{sentSub}</Text>
          {pendingInvites.length > 0 && (
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [s.shareBtn, pressed && { opacity: 0.85 }]}
              onPress={handleShare}
            >
              <MaterialIcons name="share" size={20} color={C.bg} />
              <Text style={s.shareBtnText}>Share invite link{pendingInvites.length === 1 ? '' : 's'}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.headerBtn}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={s.headerTitle}>Add members</Text>
        <Pressable
          style={s.headerBtn}
          onPress={handleSend}
          disabled={!canSend || sending}
        >
          {sending ? (
            <ActivityIndicator color={C.primary} size="small" />
          ) : (
            <Text style={[s.sendText, !canSend && { opacity: 0.35 }]}>Add</Text>
          )}
        </Pressable>
      </View>

      {groupName ? (
        <View style={s.groupBadge}>
          <MaterialIcons name="group" size={14} color={C.primary} />
          <Text style={s.groupBadgeText}>{groupName}</Text>
        </View>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <MemberSearchPicker
          excludeUserIds={existingMemberIds}
          onSelectionChange={setMemberSelection}
        />

        {error && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.sendBtn,
            !canSend && s.sendBtnDisabled,
            pressed && canSend && { opacity: 0.85 },
          ]}
          onPress={handleSend}
          disabled={!canSend || sending}
        >
          {sending ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <MaterialIcons name="person-add" size={20} color={canSend ? C.bg : C.slate500} />
              <Text style={[s.sendBtnText, !canSend && { color: C.slate500 }]}>
                {canSend
                  ? `Add ${memberSelection.appUsers.length + memberSelection.contacts.length} member${memberSelection.appUsers.length + memberSelection.contacts.length === 1 ? '' : 's'}`
                  : 'Select members above'}
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  headerBtn: { padding: 4, minWidth: 56 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 17 },
  cancelText: { color: C.slate400, fontSize: 16 },
  sendText: { color: C.primary, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  groupBadgeText: { color: C.primary, fontSize: 13, fontWeight: '600' },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  errorText: { color: C.orange, fontSize: 13 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 24,
  },
  sendBtnDisabled: { backgroundColor: C.surfaceHL },
  sendBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
  sentBody: { flex: 1, paddingHorizontal: 24, paddingTop: 48, alignItems: 'center' },
  sentIcon: { marginBottom: 24 },
  sentTitle: { color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  sentSub: { color: C.slate400, fontSize: 14, textAlign: 'center', marginBottom: 32 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  shareBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },
});
