import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
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

import { MemberSearchPicker, type MemberSelection } from '@/components/MemberSearchPicker';
import { useAuth } from '@/context/auth';
import { APP_DISPLAY_NAME, INVITE_WEB_LINK_BASE } from '@/lib/app-config';
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

type IconName = keyof typeof MaterialIcons.glyphMap;

function inferIcon(name: string): IconName {
  const t = name.toLowerCase();
  const rules: { keywords: string[]; icon: IconName }[] = [
    { keywords: ['trip', 'travel', 'flight', 'fly', 'tour', 'backpack', 'japan', 'paris', 'london', 'bali', 'euro'], icon: 'flight'           },
    { keywords: ['beach', 'holiday', 'resort', 'vacation', 'summer', 'island', 'ski', 'snow', 'camp', 'hike'],       icon: 'beach-access'     },
    { keywords: ['home', 'house', 'apartment', 'apt', 'flat', 'rent', 'roommate', 'condo'],                          icon: 'home'             },
    { keywords: ['dinner', 'lunch', 'breakfast', 'food', 'restaurant', 'eat', 'brunch', 'cafe', 'coffee', 'pizza'],  icon: 'restaurant'       },
    { keywords: ['car', 'drive', 'road', 'auto', 'uber', 'taxi'],                                                    icon: 'directions-car'   },
    { keywords: ['shop', 'mall', 'market', 'grocery', 'store', 'buy'],                                               icon: 'shopping-cart'    },
    { keywords: ['sport', 'soccer', 'football', 'cricket', 'gym', 'tennis', 'basketball', 'game', 'match'],          icon: 'sports-soccer'    },
    { keywords: ['music', 'concert', 'band', 'festival', 'party', 'gig'],                                            icon: 'music-note'       },
    { keywords: ['work', 'office', 'project', 'team', 'client', 'business', 'conf'],                                 icon: 'work'             },
    { keywords: ['school', 'class', 'course', 'study', 'college', 'university'],                                     icon: 'school'           },
    { keywords: ['hospital', 'clinic', 'medical', 'health', 'doctor'],                                               icon: 'local-hospital'   },
  ];
  for (const rule of rules) {
    if (rule.keywords.some((kw) => t.includes(kw))) return rule.icon;
  }
  return 'group';
}

function generateInviteToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberSelection, setMemberSelection] = useState<MemberSelection>({ appUsers: [], contacts: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIcon: IconName = inferIcon(name);
  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || !user) return;
    setError(null);
    setSaving(true);

    try {
      const groupId = crypto.randomUUID();
      const groupName = name.trim();

      // Insert group
      const { error: groupErr } = await supabase
        .from('groups')
        .insert({
          id: groupId,
          name: groupName,
          description: description.trim() || null,
          icon_name: selectedIcon,
          created_by: user.id,
          archived: false,
        });

      if (groupErr) {
        setError(groupErr.message ?? 'Failed to create group. Please try again.');
        setSaving(false);
        return;
      }

      // Add creator as member
      const { error: memberErr } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: user.id });

      if (memberErr) {
        setError(memberErr.message ?? 'Group created but failed to add you as member.');
        setSaving(false);
        return;
      }

      // Insert balance row for creator
      await supabase
        .from('group_balances')
        .insert({ group_id: groupId, user_id: user.id, balance_cents: 0 });

      // Add app users directly as members
      if (memberSelection.appUsers.length > 0) {
        const rows = memberSelection.appUsers.map((u) => ({
          group_id: groupId,
          user_id: u.userId,
          display_name: u.name,
          avatar_url: u.avatarUrl,
        }));
        const { error: friendErr } = await supabase.from('group_members').insert(rows);
        if (friendErr) {
          setError(friendErr.message ?? 'Group created but failed to add some members.');
          setSaving(false);
          return;
        }
      }

      // Add contacts as pending members + create invitation tokens
      const pendingInvites: { contactName: string; shareUrl: string }[] = [];
      for (const contact of memberSelection.contacts) {
        const token = generateInviteToken();
        const inviteeEmail = contact.emails[0] ?? null;

        await supabase.from('group_members').insert({
          group_id: groupId,
          user_id: null,
          display_name: contact.name,
        });

        const { error: inviteErr } = await supabase.from('invitations').insert({
          inviter_id: user.id,
          invitee_email: inviteeEmail,
          group_id: groupId,
          token,
          status: 'pending',
        });

        if (!inviteErr) {
          const shareUrl = INVITE_WEB_LINK_BASE
            ? `${INVITE_WEB_LINK_BASE}?token=${token}`
            : `paysplit://invite?token=${token}`;
          pendingInvites.push({ contactName: contact.name, shareUrl });
        }
      }

      setSaving(false);
      router.dismissAll();
      router.push({ pathname: '/group/[id]', params: { id: groupId } });

      // Open share sheet after navigation (native overlay, works on top of any screen)
      if (pendingInvites.length === 1) {
        await Share.share({
          message: `Hey ${pendingInvites[0].contactName}! Join ${groupName} on ${APP_DISPLAY_NAME}: ${pendingInvites[0].shareUrl}`,
        });
      } else if (pendingInvites.length > 1) {
        const links = pendingInvites.map((p) => `${p.contactName}: ${p.shareUrl}`).join('\n');
        await Share.share({
          message: `Join ${groupName} on ${APP_DISPLAY_NAME}!\n${links}`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setError(message);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header} testID="create-group-screen">
        <Pressable onPress={() => router.back()} style={s.headerBtn} testID="cancel-button">
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={s.headerTitle}>New Group</Text>
        <Pressable onPress={handleSave} style={s.headerBtn} disabled={!canSave || saving} testID="header-create-button">
          <Text style={[s.createText, !canSave && { opacity: 0.35 }]}>Create</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        testID="create-group-scroll"
      >
        {/* Icon preview */}
        <View style={s.previewWrap}>
          <View style={s.preview}>
            <MaterialIcons name={selectedIcon} size={48} color={C.primary} />
          </View>
          <Text style={s.previewHint}>
            {name.trim() ? 'Auto-selected · tap below to override' : 'Icon and colour chosen from group name'}
          </Text>
        </View>

        {/* Name */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>GROUP NAME *</Text>
          <TextInput
            style={s.fieldInput}
            placeholder="e.g. Japan Trip, Apartment 4B…"
            placeholderTextColor={C.slate500}
            value={name}
            onChangeText={setName}
            returnKeyType="next"
            maxLength={60}
            testID="group-name-input"
          />
        </View>

        {/* Description */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            style={[s.fieldInput, s.fieldTextarea]}
            placeholder="What's this group for? (optional)"
            placeholderTextColor={C.slate500}
            value={description}
            onChangeText={setDescription}
            returnKeyType="done"
            multiline
            maxLength={160}
            testID="group-description-input"
          />
        </View>

        {/* Add members */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>ADD MEMBERS (OPTIONAL)</Text>
          <MemberSearchPicker onSelectionChange={setMemberSelection} />
        </View>

        {error && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Create button */}
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.createBtn, !canSave && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
          onPress={handleSave}
          disabled={!canSave || saving}
          testID="create-group-button"
        >
          {saving ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <MaterialIcons name="group-add" size={22} color={C.bg} />
              <Text style={s.createBtnText}>Create Group</Text>
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
  headerBtn: { padding: 4, minWidth: 60 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 17 },
  cancelText: { color: C.slate400, fontSize: 16 },
  createText: { color: C.primary, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  scroll: { paddingHorizontal: 20 },
  previewWrap: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  preview: {
    width: 100, height: 100, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceHL,
  },
  previewHint: { color: C.slate400, fontSize: 13 },
  fieldBlock: { marginBottom: 24 },
  fieldLabel: { color: C.slate500, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  fieldInput: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: C.white,
    fontSize: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  fieldTextarea: { minHeight: 80, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  errorText: { color: C.orange, fontSize: 13 },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16,
    marginTop: 8,
  },
  createBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
