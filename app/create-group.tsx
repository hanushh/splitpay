import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { useExistingFriends } from '@/hooks/use-existing-friends';
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateInviteToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { friends } = useExistingFriends();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberEmails, setMemberEmails] = useState<string[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(new Set());
  const [showEmailInvite, setShowEmailInvite] = useState(false);

  const selectedIcon: IconName = inferIcon(name);
  const [emailInput, setEmailInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0;

  const addEmail = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_REGEX.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (memberEmails.includes(email)) {
      setError('This email is already added.');
      return;
    }
    setError(null);
    setMemberEmails((prev) => [...prev, email]);
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    setMemberEmails((prev) => prev.filter((e) => e !== email));
  };

  const toggleFriend = (userId: string) => {
    setSelectedFriendIds((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!canSave || !user) return;
    setError(null);
    setSaving(true);

    try {
      // Pre-generate the group ID so we never need to read the row back after insert
      const groupId = crypto.randomUUID();

      // Insert group
      const { error: groupErr } = await supabase
        .from('groups')
        .insert({
          id: groupId,
          name: name.trim(),
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

      // Insert balance row for creator (ignore error — view may auto-populate)
      await supabase
        .from('group_balances')
        .insert({ group_id: groupId, user_id: user.id, balance_cents: 0 });

      // Add selected existing friends directly as members
      if (selectedFriendIds.size > 0) {
        const friendRows = Array.from(selectedFriendIds).map((userId) => {
          const friend = friends.find((f) => f.userId === userId);
          return {
            group_id: groupId,
            user_id: userId,
            display_name: friend?.displayName ?? null,
            avatar_url: friend?.avatarUrl ?? null,
          };
        });
        const { error: friendErr } = await supabase.from('group_members').insert(friendRows);
        if (friendErr) console.warn('Failed to add selected friends:', friendErr.message);
      }

      // Create invitations for each added email and send notification emails
      if (memberEmails.length > 0) {
        const inviteTokens: string[] = [];
        const rows = memberEmails.map((invitee_email) => {
          const token = generateInviteToken();
          inviteTokens.push(token);
          return { inviter_id: user.id, invitee_email, group_id: groupId, token, status: 'pending' };
        });
        const { error: inviteErr } = await supabase.from('invitations').insert(rows);
        if (inviteErr) {
          // Non-fatal: group is created, just warn
          console.warn('Failed to create invitations:', inviteErr.message);
        } else {
          // Trigger email notifications for invited members (non-fatal)
          supabase.functions.invoke('send-invitation-email', {
            body: { tokens: inviteTokens },
          }).catch((err: unknown) => console.warn('[Email] Failed to dispatch invitation emails:', err));
        }
      }

      setSaving(false);
      // Dismiss the modal first, then navigate to the new group.
      // router.replace() from inside a modal does not reliably navigate to a
      // non-modal screen in Expo Router — dismissAll + push is the documented pattern.
      router.dismissAll();
      router.push({ pathname: '/group/[id]', params: { id: groupId } });
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

          {/* Existing friends picker */}
          {friends.length > 0 && (
            <View style={s.friendPickerWrap}>
              <Text style={s.friendPickerLabel}>From your groups</Text>
              <View style={s.friendChipWrap}>
                {friends.map((friend) => {
                  const selected = selectedFriendIds.has(friend.userId);
                  return (
                    <Pressable
                      key={friend.userId}
                      style={[s.friendChip, selected && s.friendChipSelected]}
                      onPress={() => toggleFriend(friend.userId)}
                    >
                      {friend.avatarUrl ? (
                        <Image source={{ uri: friend.avatarUrl }} style={s.friendAvatar} />
                      ) : (
                        <View style={[s.friendAvatarPlaceholder, selected && s.friendAvatarPlaceholderSelected]}>
                          <Text style={[s.friendAvatarInitial, selected && s.friendAvatarInitialSelected]}>
                            {friend.displayName.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={[s.friendChipName, selected && s.friendChipNameSelected]} numberOfLines={1}>
                        {friend.displayName}
                      </Text>
                      {selected && (
                        <MaterialIcons name="check-circle" size={16} color={C.bg} style={s.friendChipCheck} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <Pressable
            style={s.emailToggle}
            onPress={() => setShowEmailInvite((v) => !v)}
          >
            <MaterialIcons
              name={showEmailInvite ? "keyboard-arrow-up" : "keyboard-arrow-down"}
              size={18}
              color={C.slate400}
            />
            <Text style={s.emailToggleText}>Invite by email</Text>
          </Pressable>

          {showEmailInvite && (
            <View style={s.emailInviteWrap}>
              <Text style={s.fieldHint}>They’ll join this group when they sign up.</Text>
              <View style={s.emailRow}>
                <TextInput
                  style={s.emailInput}
                  placeholder="email@example.com"
                  placeholderTextColor={C.slate500}
                  value={emailInput}
                  onChangeText={(t: string) => { setEmailInput(t); setError(null); }}
                  onSubmitEditing={addEmail}
                  returnKeyType="done"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="member-email-input"
                />
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.addEmailBtn, pressed && { opacity: 0.8 }]}
                  onPress={addEmail}
                  testID="add-member-button"
                >
                  <MaterialIcons name="person-add" size={20} color={C.bg} />
                  <Text style={s.addEmailBtnText}>Add</Text>
                </Pressable>
              </View>
            </View>
          )}
          {memberEmails.length > 0 && (
            <View style={s.chipWrap}>
              {memberEmails.map((email) => (
                <View key={email} style={s.chip}>
                  <Text style={s.chipText} numberOfLines={1}>{email}</Text>
                  <Pressable hitSlop={8} onPress={() => removeEmail(email)} style={s.chipRemove}>
                    <MaterialIcons name="close" size={16} color={C.slate400} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
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
  // Preview
  previewWrap: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  preview: {
    width: 100, height: 100, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceHL,
  },
  previewHint: { color: C.slate400, fontSize: 13 },
  // Fields
  fieldBlock: { marginBottom: 24 },
  fieldLabel: { color: C.slate500, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 },
  fieldHint: { color: C.slate400, fontSize: 12, marginBottom: 10 },
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
  // Add members
  emailRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  emailInput: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: C.white,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  addEmailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  addEmailBtnText: { color: C.bg, fontWeight: '700', fontSize: 14 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceHL,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 6,
    borderRadius: 999,
    maxWidth: '100%',
  },
  chipText: { color: C.white, fontSize: 13, maxWidth: 180 },
  chipRemove: { padding: 4 },
  // Error
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  errorText: { color: C.orange, fontSize: 13 },
  // Email invite toggle
  emailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  emailToggleText: { color: C.slate400, fontSize: 13, fontWeight: '600' },
  emailInviteWrap: { marginTop: 8 },
  // Friend picker
  friendPickerWrap: { marginBottom: 16 },
  friendPickerLabel: { color: C.slate500, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 },
  friendChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  friendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.surfaceHL,
    paddingVertical: 7,
    paddingLeft: 6,
    paddingRight: 10,
    borderRadius: 999,
  },
  friendChipSelected: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  friendAvatar: { width: 24, height: 24, borderRadius: 12 },
  friendAvatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarPlaceholderSelected: { backgroundColor: 'rgba(0,0,0,0.2)' },
  friendAvatarInitial: { color: C.slate400, fontSize: 11, fontWeight: '700' },
  friendAvatarInitialSelected: { color: C.bg },
  friendChipName: { color: C.white, fontSize: 13, fontWeight: '500', maxWidth: 100 },
  friendChipNameSelected: { color: C.bg, fontWeight: '700' },
  friendChipCheck: { marginLeft: 2 },
  // Create button
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16,
    marginTop: 8,
  },
  createBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
