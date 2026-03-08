import { MaterialIcons } from '@expo/vector-icons';
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

const ICONS: { name: keyof typeof MaterialIcons.glyphMap; label: string }[] = [
  { name: 'group',           label: 'Group'      },
  { name: 'home',            label: 'Home'        },
  { name: 'flight',          label: 'Travel'      },
  { name: 'restaurant',      label: 'Food'        },
  { name: 'beach-access',    label: 'Vacation'    },
  { name: 'directions-car',  label: 'Road trip'   },
  { name: 'shopping-cart',   label: 'Shopping'    },
  { name: 'sports-soccer',   label: 'Sports'      },
  { name: 'music-note',      label: 'Music'       },
  { name: 'local-hospital',  label: 'Medical'     },
  { name: 'school',          label: 'Education'   },
  { name: 'work',            label: 'Work'        },
];

const COLORS = [
  { value: 'rgba(99,102,241,0.3)',  display: '#818cf8' },
  { value: 'rgba(20,184,166,0.3)',  display: '#2dd4bf' },
  { value: 'rgba(249,115,22,0.3)', display: '#f97316' },
  { value: 'rgba(239,68,68,0.3)',  display: '#f87171' },
  { value: 'rgba(234,179,8,0.3)',  display: '#facc15' },
  { value: 'rgba(23,232,107,0.3)', display: '#17e86b' },
  { value: 'rgba(168,85,247,0.3)', display: '#c084fc' },
  { value: 'rgba(236,72,153,0.3)', display: '#f472b6' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateInviteToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CreateGroupScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<keyof typeof MaterialIcons.glyphMap>('group');
  const [selectedColor, setSelectedColor] = useState(COLORS[0].value);
  const [memberEmails, setMemberEmails] = useState<string[]>([]);
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

  const handleSave = async () => {
    if (!canSave || !user) return;
    setError(null);
    setSaving(true);

    // Insert group
    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        bg_color: selectedColor,
        icon_name: selectedIcon,
        created_by: user.id,
        archived: false,
      })
      .select('id')
      .single();

    if (groupErr || !group) {
      setError(groupErr?.message ?? 'Failed to create group. Please try again.');
      setSaving(false);
      return;
    }

    // Add creator as member
    const { error: memberErr } = await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: user.id });

    if (memberErr) {
      setError(memberErr.message ?? 'Group created but failed to add you as member.');
      setSaving(false);
      return;
    }

    // Insert balance row for creator (ignore error — view may auto-populate)
    await supabase
      .from('group_balances')
      .insert({ group_id: group.id, user_id: user.id, balance_cents: 0 });

    // Create invitations for each added email
    if (memberEmails.length > 0) {
      const rows = memberEmails.map((invitee_email) => ({
        inviter_id: user.id,
        invitee_email,
        group_id: group.id,
        token: generateInviteToken(),
        status: 'pending',
      }));
      const { error: inviteErr } = await supabase.from('invitations').insert(rows);
      if (inviteErr) {
        // Non-fatal: group is created, just warn
        console.warn('Failed to create invitations:', inviteErr.message);
      }
    }

    setSaving(false);
    router.replace({ pathname: '/group/[id]', params: { id: group.id } });
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
          <View style={[s.preview, { backgroundColor: selectedColor }]}>
            <MaterialIcons name={selectedIcon} size={48} color={C.primary} />
          </View>
          <Text style={s.previewHint}>Choose an icon and colour below</Text>
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

        {/* Icon picker */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>ICON</Text>
          <View style={s.iconGrid}>
            {ICONS.map((ic) => {
              const active = selectedIcon === ic.name;
              return (
                <Pressable
                  key={ic.name}
                  style={({ pressed }: { pressed: boolean }) => [s.iconCell, active && s.iconCellActive, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelectedIcon(ic.name)}
                >
                  <MaterialIcons
                    name={ic.name}
                    size={26}
                    color={active ? C.bg : C.slate400}
                  />
                  <Text style={[s.iconLabel, active && s.iconLabelActive]}>{ic.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Color picker */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>COLOUR</Text>
          <View style={s.colorRow}>
            {COLORS.map((c) => {
              const active = selectedColor === c.value;
              return (
                <Pressable
                  key={c.value}
                  style={({ pressed }: { pressed: boolean }) => [s.colorSwatch, { backgroundColor: c.display }, active && s.colorSwatchActive, pressed && { opacity: 0.8 }]}
                  onPress={() => setSelectedColor(c.value)}
                >
                  {active && <MaterialIcons name="check" size={18} color="#fff" />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Add members */}
        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>ADD MEMBERS (OPTIONAL)</Text>
          <Text style={s.fieldHint}>Enter email addresses to invite. They’ll join this group when they sign up.</Text>
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
  // Icon grid
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconCell: {
    width: 72, alignItems: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.surfaceHL,
  },
  iconCellActive: { backgroundColor: C.primary, borderColor: C.primary },
  iconLabel: { color: C.slate400, fontSize: 10, fontWeight: '600' },
  iconLabelActive: { color: C.bg },
  // Color row
  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  colorSwatch: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchActive: {
    borderWidth: 3, borderColor: C.white,
    shadowColor: '#fff', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
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
  // Create button
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16,
    marginTop: 8,
  },
  createBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
