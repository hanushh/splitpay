import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import {
  MemberSearchPicker,
  type MemberSelection,
} from '@/components/MemberSearchPicker';
import { useAuth } from '@/context/auth';
import {
  APP_DISPLAY_NAME,
  INVITE_LINK_PREFIX,
  INVITE_WEB_LINK_BASE,
} from '@/lib/app-config';
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

interface GroupOption {
  id: string;
  name: string;
}

export default function InviteFriendScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    groupId: paramGroupId,
    groupName: paramGroupName,
    userId: paramUserId,
    name: paramName,
  } = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
    userId?: string;
    name?: string;
  }>();

  // Active group (from params or user-selected)
  const [activeGroupId, setActiveGroupId] = useState<string>(
    paramGroupId ?? '',
  );
  const [activeGroupName, setActiveGroupName] = useState<string>(
    paramGroupName ?? '',
  );

  // Group picker (shown when no groupId is provided via params)
  const [userGroups, setUserGroups] = useState<GroupOption[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const [existingMemberIds, setExistingMemberIds] = useState<string[]>([]);
  const [existingContactNames, setExistingContactNames] = useState<string[]>(
    [],
  );

  // When coming from Friends tab with a pre-selected user, seed memberSelection
  const [memberSelection, setMemberSelection] = useState<MemberSelection>(
    () => {
      if (paramUserId && paramName) {
        return {
          appUsers: [{ userId: paramUserId, name: paramName, avatarUrl: null }],
          contacts: [],
        };
      }
      return { appUsers: [], contacts: [] };
    },
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success state
  const [sent, setSent] = useState(false);
  const [addedUsersCount, setAddedUsersCount] = useState(0);
  const [pendingInvites, setPendingInvites] = useState<
    { contactName: string; shareUrl: string }[]
  >([]);

  // Fetch user's groups when no groupId param (for the picker)
  useEffect(() => {
    if (paramGroupId || !user) return;
    supabase
      .from('group_members')
      .select('groups!inner(id, name)')
      .eq('user_id', user.id)
      .then(({ data, error: groupsErr }) => {
        if (groupsErr) {
          setError(groupsErr.message ?? t('invite.failedLoadGroups'));
          return;
        }
        const seen = new Set<string>();
        const list = (data ?? [])
          .map((row: any) => row.groups as GroupOption)
          .filter(Boolean)
          .filter((g: GroupOption) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          });
        setUserGroups(list);
      });
  }, [paramGroupId, user]);

  const loadExistingMembers = useCallback(async (gid: string) => {
    if (!gid) return;
    const { data } = await supabase
      .from('group_members')
      .select('user_id, display_name')
      .eq('group_id', gid);
    const rows = (data ?? []) as {
      user_id: string | null;
      display_name: string | null;
    }[];
    setExistingMemberIds(
      rows.map((r) => r.user_id).filter(Boolean) as string[],
    );
    setExistingContactNames(
      rows
        .filter((r) => !r.user_id && r.display_name)
        .map((r) => r.display_name!),
    );
  }, []);

  useEffect(() => {
    loadExistingMembers(activeGroupId);
  }, [activeGroupId, loadExistingMembers]);

  const handleSelectGroup = useCallback((group: GroupOption) => {
    setActiveGroupId(group.id);
    setActiveGroupName(group.name);
    setGroupPickerOpen(false);
  }, []);

  const canSend =
    (memberSelection.appUsers.length > 0 ||
      memberSelection.contacts.length > 0) &&
    !!activeGroupId;

  const handleSend = async () => {
    if (!canSend || !user || !activeGroupId) return;
    setError(null);
    setSending(true);

    let addedCount = 0;

    // Add app users directly
    if (memberSelection.appUsers.length > 0) {
      const { data: addData, error: addErr } = await supabase.rpc(
        'add_group_members_by_ids',
        {
          p_group_id: activeGroupId,
          p_user_ids: memberSelection.appUsers.map((u) => u.userId),
        },
      );
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
        group_id: activeGroupId,
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
        group_id: activeGroupId,
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
          message: `Hey ${pendingInvites[0].contactName}! Join ${activeGroupName ?? 'our group'} on ${APP_DISPLAY_NAME}: ${pendingInvites[0].shareUrl}`,
        });
      } else {
        const links = pendingInvites
          .map((p) => `${p.contactName}: ${p.shareUrl}`)
          .join('\n');
        await Share.share({
          message: `Join ${activeGroupName ?? 'our group'} on ${APP_DISPLAY_NAME}!\n${links}`,
        });
      }
    } catch {}
  };

  const sentTitle = (() => {
    if (addedUsersCount > 0 && pendingInvites.length > 0) {
      return t('invite.membersAdded');
    }
    if (addedUsersCount > 0) {
      return t('invite.membersAdded');
    }
    return t('invite.shareInviteLink', { plural: pendingInvites.length === 1 ? '' : 's' });
  })();

  const sentSub =
    pendingInvites.length > 0
      ? `Share the invite link${pendingInvites.length === 1 ? '' : 's'} so they can join "${activeGroupName}".`
      : `They've been added to "${activeGroupName}".`;

  if (sent) {
    return (
      <KeyboardAvoidingView
        style={[s.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn}>
            <Text style={s.cancelText}>{t('invite.done')}</Text>
          </Pressable>
          <Text style={s.headerTitle}>{t('invite.membersAdded')}</Text>
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
              style={({ pressed }: { pressed: boolean }) => [
                s.shareBtn,
                pressed && { opacity: 0.85 },
              ]}
              onPress={handleShare}
            >
              <MaterialIcons name="share" size={20} color={C.bg} />
              <Text style={s.shareBtnText}>
                {t('invite.shareInviteLink', { plural: pendingInvites.length === 1 ? '' : 's' })}
              </Text>
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
          <Text style={s.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={s.headerTitle}>{t('invite.title')}</Text>
        <Pressable
          style={s.headerBtn}
          onPress={handleSend}
          disabled={!canSend || sending}
        >
          {sending ? (
            <ActivityIndicator color={C.primary} size="small" />
          ) : (
            <Text style={[s.sendText, !canSend && { opacity: 0.35 }]}>{t('invite.add')}</Text>
          )}
        </Pressable>
      </View>

      {/* Group picker row — shown always, tappable when no param groupId */}
      <Pressable
        style={s.groupBadge}
        onPress={!paramGroupId ? () => setGroupPickerOpen(true) : undefined}
        disabled={!!paramGroupId}
      >
        <MaterialIcons name="group" size={14} color={C.primary} />
        {activeGroupName ? (
          <Text style={s.groupBadgeText}>{activeGroupName}</Text>
        ) : (
          <Text style={s.groupBadgePlaceholder}>Select a group…</Text>
        )}
        {!paramGroupId && (
          <MaterialIcons
            name="arrow-drop-down"
            size={18}
            color={C.slate400}
            style={s.groupDropdownIcon}
          />
        )}
      </Pressable>

      {/* Pre-selected friend chip (when navigating from Friends tab) */}
      {paramUserId && paramName ? (
        <View style={s.preselectedRow}>
          <MaterialIcons name="person" size={16} color={C.primary} />
          <Text style={s.preselectedName}>{paramName}</Text>
          <View style={s.preselectedChip}>
            <Text style={s.preselectedChipText}>Selected</Text>
          </View>
        </View>
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          s.scroll,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Only show member search picker when no pre-selected friend */}
        {!paramUserId && (
          <MemberSearchPicker
            excludeUserIds={existingMemberIds}
            excludeContactNames={existingContactNames}
            onSelectionChange={setMemberSelection}
          />
        )}

        {!activeGroupId && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>Please select a group first.</Text>
          </View>
        )}

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
              <MaterialIcons
                name="person-add"
                size={20}
                color={canSend ? C.bg : C.slate500}
              />
              <Text style={[s.sendBtnText, !canSend && { color: C.slate500 }]}>
                {!activeGroupId
                  ? t('invite.selectMembers')
                  : canSend
                    ? t('invite.addCount', { count: memberSelection.appUsers.length + memberSelection.contacts.length, plural: memberSelection.appUsers.length + memberSelection.contacts.length === 1 ? '' : 's' })
                    : t('invite.selectMembers')}
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* Group picker modal */}
      <Modal
        visible={groupPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGroupPickerOpen(false)}
      >
        <Pressable
          style={s.modalOverlay}
          onPress={() => setGroupPickerOpen(false)}
        />
        <View style={[s.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>{t('expense.selectGroupSheet')}</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {userGroups.map((g) => (
              <Pressable
                key={g.id}
                style={({ pressed }: { pressed: boolean }) => [
                  s.groupRow,
                  g.id === activeGroupId && s.groupRowSelected,
                  pressed && { opacity: 0.75 },
                ]}
                onPress={() => handleSelectGroup(g)}
              >
                <MaterialIcons
                  name="group"
                  size={20}
                  color={g.id === activeGroupId ? C.primary : C.slate400}
                />
                <Text
                  style={[
                    s.groupRowText,
                    g.id === activeGroupId && { color: C.primary },
                  ]}
                >
                  {g.name}
                </Text>
                {g.id === activeGroupId && (
                  <MaterialIcons name="check" size={18} color={C.primary} />
                )}
              </Pressable>
            ))}
            {userGroups.length === 0 && (
              <Text style={s.noGroupsText}>
                {"You haven't joined any groups yet."}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
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
  sendText: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  groupBadgeText: {
    color: C.primary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  groupBadgePlaceholder: { color: C.slate400, fontSize: 13, flex: 1 },
  groupDropdownIcon: { marginLeft: 'auto' },
  preselectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
    backgroundColor: C.surface,
  },
  preselectedName: { color: C.white, fontWeight: '600', fontSize: 14, flex: 1 },
  preselectedChip: {
    backgroundColor: C.surfaceHL,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  preselectedChipText: { color: C.primary, fontSize: 11, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingTop: 16 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
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
  sentBody: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    alignItems: 'center',
  },
  sentIcon: { marginBottom: 24 },
  sentTitle: {
    color: C.white,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  sentSub: {
    color: C.slate400,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
  },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '60%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: C.surfaceHL,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: C.white,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 12,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  groupRowSelected: { backgroundColor: 'transparent' },
  groupRowText: { flex: 1, color: C.white, fontSize: 15, fontWeight: '500' },
  noGroupsText: {
    color: C.slate400,
    fontSize: 14,
    paddingVertical: 20,
    textAlign: 'center',
  },
});
