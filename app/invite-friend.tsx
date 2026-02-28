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
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { APP_DISPLAY_NAME, INVITE_LINK_PREFIX } from '@/lib/app-config';
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
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { groupId: paramGroupId, groupName: paramGroupName } = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
  }>();

  const [email, setEmail] = useState('');
  const [groupId, setGroupId] = useState<string>(paramGroupId ?? '');
  const [groupName, setGroupName] = useState<string>(paramGroupName ?? '');
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('groups')
      .select('id, name')
      .order('name');
    setGroups((data as GroupOption[]) ?? []);
    if (paramGroupId && paramGroupName) {
      setGroupId(paramGroupId);
      setGroupName(paramGroupName);
    }
  }, [user, paramGroupId, paramGroupName]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const canSend = email.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSendInvite = async () => {
    if (!canSend || !user) return;
    setError(null);
    setSending(true);

    const token = generateToken();
    const { error: insertErr } = await supabase.from('invitations').insert({
      inviter_id: user.id,
      invitee_email: email.trim().toLowerCase(),
      group_id: groupId || null,
      token,
      status: 'pending',
    });

    if (insertErr) {
      setError(insertErr.message);
      setSending(false);
      return;
    }

    // Deep link into app: scheme://invite?token=xxx
    const link = `${INVITE_LINK_PREFIX}?token=${encodeURIComponent(token)}`;
    setInviteLink(link);
    setSent(true);
    setSending(false);
  };

  const handleShare = async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        message: `Join me on ${APP_DISPLAY_NAME} to split expenses! ${inviteLink}`,
        url: inviteLink,
        title: `${APP_DISPLAY_NAME} invite`,
      });
    } catch (_) {}
  };

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
          <Text style={s.headerTitle}>Invite sent</Text>
          <View style={s.headerBtn} />
        </View>
        <View style={s.sentBody}>
          <View style={s.sentIcon}>
            <MaterialIcons name="check-circle" size={64} color={C.primary} />
          </View>
          <Text style={s.sentTitle}>Invitation sent to {email}</Text>
          {groupName ? (
            <Text style={s.sentSub}>They’ll be added to “{groupName}” when they join.</Text>
          ) : (
            <Text style={s.sentSub}>They can sign up and connect with you on the app.</Text>
          )}
          <Pressable style={({ pressed }) => [s.shareBtn, pressed && { opacity: 0.85 }]} onPress={handleShare}>
            <MaterialIcons name="share" size={20} color={C.bg} />
            <Text style={s.shareBtnText}>Share invite link</Text>
          </Pressable>
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
        <Text style={s.headerTitle}>Invite friend</Text>
        <View style={s.headerBtn} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.label}>FRIEND'S EMAIL</Text>
        <TextInput
          style={s.input}
          placeholder="email@example.com"
          placeholderTextColor={C.slate500}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={[s.label, { marginTop: 20 }]}>ADD TO GROUP (OPTIONAL)</Text>
        <View style={s.groupPicker}>
          <Pressable
            style={s.groupOption}
            onPress={() => { setGroupId(''); setGroupName(''); }}
          >
            <MaterialIcons name="group" size={20} color={!groupId ? C.primary : C.slate400} />
            <Text style={[s.groupOptionText, !groupId && { color: C.primary }]}>
              No group – invite to app only
            </Text>
            {!groupId && <MaterialIcons name="check" size={20} color={C.primary} />}
          </Pressable>
          {(groups as GroupOption[]).map((g) => (
            <Pressable
              key={g.id}
              style={s.groupOption}
              onPress={() => { setGroupId(g.id); setGroupName(g.name); }}
            >
              <MaterialIcons name="group" size={20} color={groupId === g.id ? C.primary : C.slate400} />
              <Text style={[s.groupOptionText, groupId === g.id && { color: C.primary }]}>{g.name}</Text>
              {groupId === g.id && <MaterialIcons name="check" size={20} color={C.primary} />}
            </Pressable>
          ))}
        </View>

        {error && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [s.sendBtn, !canSend && s.sendBtnDisabled, pressed && canSend && { opacity: 0.85 }]}
          onPress={handleSendInvite}
          disabled={!canSend || sending}
        >
          {sending ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <MaterialIcons name="send" size={20} color={canSend ? C.bg : C.slate500} />
              <Text style={[s.sendBtnText, !canSend && { color: C.slate500 }]}>Send invite</Text>
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
  scroll: { paddingHorizontal: 20, paddingTop: 24 },
  label: { color: C.slate500, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.white,
    fontSize: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  groupPicker: { gap: 4 },
  groupOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  groupOptionText: { flex: 1, color: C.white, fontSize: 15 },
  hint: { color: C.slate500, fontSize: 12, marginTop: 8 },
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
    marginTop: 32,
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
