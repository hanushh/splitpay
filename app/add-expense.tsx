import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { CURRENCIES, Currency, useCurrency } from '@/context/currency';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  red: '#ef4444',
  orange: '#f97316',
};

const CATEGORIES = [
  { id: 'restaurant', label: 'Food & Drink', icon: 'restaurant' },
  { id: 'train',      label: 'Transport',    icon: 'directions-car' },
  { id: 'hotel',      label: 'Accommodation', icon: 'hotel' },
  { id: 'movie',      label: 'Entertainment', icon: 'movie' },
  { id: 'store',      label: 'Shopping',      icon: 'shopping-bag' },
  { id: 'other',      label: 'Other',         icon: 'receipt-long' },
] as const;

interface GroupOption {
  id: string;
  name: string;
  icon_name: string | null;
  bg_color: string;
}

interface Member {
  id: string;          // group_member UUID
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
}

export default function AddExpenseScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currency: appCurrency } = useCurrency();

  const { groupId: urlGroupId, groupName: urlGroupName } =
    useLocalSearchParams<{ groupId?: string; groupName?: string }>();

  // ── Group selection ────────────────────────────────────────
  const [groupId, setGroupId] = useState<string>(urlGroupId ?? '');
  const [groupName, setGroupName] = useState<string>(urlGroupName ?? '');
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  // ── Members (loaded when group changes) ───────────────────
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // ── Form state ────────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState<Currency>(appCurrency);
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [paidBy, setPaidBy] = useState<string>('');
  const [splitMethod, setSplitMethod] = useState<'equally' | 'exact' | 'percent'>('equally');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<string>('other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load only groups the current user is a member of
  useEffect(() => {
    if (!user) return;
    supabase
      .from('group_members')
      .select('groups!inner(id, name, icon_name, bg_color)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const list = (data ?? []).map((row: any) => row.groups as GroupOption).filter(Boolean);
        setGroups(list);
      });
  }, [user]);

  // Load members whenever groupId changes
  const loadMembers = useCallback(async (gid: string) => {
    if (!user || !gid) return;
    setMembersLoading(true);
    const { data } = await supabase
      .from('group_members')
      .select('id, display_name, avatar_url, user_id')
      .eq('group_id', gid);

    // Deduplicate by user_id (DB can have duplicate rows from repeated init)
    const seenUserIds = new Set<string>();
    const seenNullUserIds = new Set<string>();
    const raw = (data ?? []).filter((m) => {
      if (m.user_id) {
        if (seenUserIds.has(m.user_id)) return false;
        seenUserIds.add(m.user_id);
      } else {
        if (seenNullUserIds.has(m.id)) return false;
        seenNullUserIds.add(m.id);
      }
      return true;
    });

    // Fetch profile names for members with user_id but null display_name
    const userIdsNeedingProfile = raw.filter((m) => m.user_id && !m.display_name).map((m) => m.user_id!);
    let profileMap: Record<string, { name: string; avatar_url: string | null }> = {};
    if (userIdsNeedingProfile.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', userIdsNeedingProfile);
      profileMap = (profiles ?? []).reduce(
        (acc, p) => ({ ...acc, [p.id]: { name: p.name ?? 'Unknown', avatar_url: p.avatar_url } }),
        {} as Record<string, { name: string; avatar_url: string | null }>,
      );
    }

    const list: Member[] = raw.map((m) => {
      const isMe = m.user_id === user.id;
      let displayName: string;
      let avatar: string | null = m.avatar_url;
      if (isMe) {
        displayName = 'You';
      } else if (m.user_id && profileMap[m.user_id]) {
        displayName = profileMap[m.user_id].name;
        avatar = profileMap[m.user_id].avatar_url ?? avatar;
      } else {
        displayName = m.display_name ?? 'Unknown';
      }
      return {
        id: m.id,
        display_name: displayName,
        avatar_url: avatar,
        is_me: isMe,
      };
    });

    setMembers(list);
    const me = list.find((m) => m.is_me);
    if (me) {
      setPaidBy(me.id);
      setSelectedMembers(new Set(list.map((m) => m.id)));
    }
    setMembersLoading(false);
  }, [user]);

  useEffect(() => {
    if (groupId) loadMembers(groupId);
  }, [groupId, loadMembers]);

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const canSave = !!description && !!amount && !!groupId && selectedMembers.size > 0 && !!paidBy;

  const handleSave = async () => {
    if (!user) return;
    setError(null);

    const amtCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amtCents) || amtCents <= 0) { setError('Enter a valid amount greater than zero.'); return; }
    if (!groupId) { setError('Please select a group.'); return; }
    if (!paidBy) { setError('Please select who paid.'); return; }
    if (selectedMembers.size === 0) { setError('Select at least one member to split with.'); return; }
    if (!description.trim()) { setError('Please add a description.'); return; }

    setSaving(true);

    // Insert expense
    const { data: expense, error: expErr } = await supabase
      .from('expenses')
      .insert({
        group_id: groupId,
        description: description.trim(),
        amount_cents: amtCents,
        paid_by_member_id: paidBy,
        category,
      })
      .select('id')
      .single();

    if (expErr || !expense) {
      setError(expErr?.message ?? 'Failed to save expense');
      setSaving(false);
      return;
    }

    // Compute equal splits (last member absorbs rounding difference)
    const splitIds = [...selectedMembers];
    const perPerson = Math.round(amtCents / splitIds.length);
    const splits = splitIds.map((memberId, i) => ({
      expense_id: expense.id,
      member_id: memberId,
      amount_cents: i === splitIds.length - 1
        ? amtCents - perPerson * (splitIds.length - 1)
        : perPerson,
    }));

    const { error: splitErr } = await supabase.from('expense_splits').insert(splits);
    if (splitErr) {
      setError(splitErr.message ?? 'Expense saved but splits failed');
      setSaving(false);
      return;
    }

    setSaving(false);
    router.back();
  };

  const handleGroupSelect = (g: GroupOption) => {
    setGroupId(g.id);
    setGroupName(g.name);
    setGroupPickerOpen(false);
    setMembers([]);
    setSelectedMembers(new Set());
    setPaidBy('');
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header} testID="add-expense-screen">
        <Pressable onPress={() => router.back()} style={s.headerBtn} testID="cancel-button">
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={s.headerTitle}>Add expense</Text>
        <Pressable onPress={handleSave} style={s.headerBtn} disabled={!canSave || saving} testID="header-save-button">
          <Text style={[s.saveText, !canSave && { opacity: 0.35 }]}>Save</Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Group selector — always visible, required */}
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.groupRow, pressed && { opacity: 0.75 }]}
          onPress={() => setGroupPickerOpen(true)}
          testID="group-picker-button"
        >
          <View style={s.inputIcon}>
            <MaterialIcons name="group" size={22} color={groupId ? C.primary : C.slate400} />
          </View>
          <Text style={[s.groupRowText, !groupId && s.groupRowPlaceholder]}>
            {groupId ? groupName : 'Select a group (required)'}
          </Text>
          <MaterialIcons name="arrow-drop-down" size={22} color={C.slate400} />
        </Pressable>

        {/* Description */}
        <View style={s.inputRow}>
          <View style={s.inputIcon}>
            <MaterialIcons name="receipt-long" size={22} color={C.slate400} />
          </View>
          <TextInput
            style={s.input}
            placeholder="Description (e.g. Dinner)"
            placeholderTextColor={C.slate400}
            value={description}
            onChangeText={setDescription}
            returnKeyType="next"
            testID="description-input"
          />
        </View>

        {/* Amount */}
        <View style={[s.inputRow, s.amountRow]}>
          <View style={s.inputIcon}>
            <MaterialIcons name="payments" size={22} color={C.slate400} />
          </View>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.currencyBadge, pressed && { opacity: 0.7 }]}
            onPress={() => setCurrencyPickerOpen(true)}
          >
            <Text style={s.currencyBadgeFlag}>{expenseCurrency.flag}</Text>
            <Text style={s.currencyBadgeCode}>{expenseCurrency.code}</Text>
            <MaterialIcons name="arrow-drop-down" size={18} color={C.primary} />
          </Pressable>
          <TextInput
            style={[s.input, s.amountInput]}
            placeholder="0.00"
            placeholderTextColor={C.slate400}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            returnKeyType="done"
            testID="amount-input"
          />
        </View>

        {/* Error */}
        {error && (
          <View style={s.errorRow}>
            <MaterialIcons name="error-outline" size={16} color={C.orange} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Members-dependent sections — shown only after group selected */}
        {groupId && (
          membersLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
          ) : (
            <>
              {/* Paid by */}
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <MaterialIcons name="person" size={20} color={C.slate400} />
                  <Text style={s.sectionLabel}>Paid by</Text>
                </View>
                <View style={s.memberPills} testID="paid-by-section">
                  {members.map((m) => (
                    <Pressable
                      key={m.id}
                      style={[s.paidPill, paidBy === m.id && s.paidPillActive]}
                      onPress={() => setPaidBy(m.id)}
                      testID={`paid-by-${m.id}`}
                    >
                      <View style={[s.paidInitial, paidBy === m.id && s.paidInitialActive]}>
                        <Text style={[s.paidInitialText, paidBy === m.id && { color: C.bg }]}>
                          {(m.display_name || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[s.paidName, paidBy === m.id && { color: C.white }]}>
                        {m.display_name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Split method */}
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <MaterialIcons name="call-split" size={20} color={C.slate400} />
                  <Text style={s.sectionLabel}>Split</Text>
                </View>
                <View style={s.splitRow}>
                  {(['equally', 'exact', 'percent'] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[s.splitBtn, splitMethod === m && s.splitBtnActive]}
                      onPress={() => setSplitMethod(m)}
                      testID={`split-method-${m}`}
                    >
                      <Text style={[s.splitBtnText, splitMethod === m && s.splitBtnTextActive]}>
                        {m === 'equally' ? 'Equally' : m === 'exact' ? 'Exact' : 'Percent'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {splitMethod !== 'equally' && (
                  <Text style={s.splitComingSoon}>
                    Only equal splits are supported right now. Exact and percent splits coming soon.
                  </Text>
                )}
              </View>

              {/* Share with */}
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <MaterialIcons name="people" size={20} color={C.slate400} />
                  <Text style={s.sectionLabel}>Share with</Text>
                </View>
                <View style={s.shareGrid} testID="share-with-section">
                  {members.map((m) => {
                    const selected = selectedMembers.has(m.id);
                    return (
                      <Pressable key={m.id} style={s.shareItem} onPress={() => toggleMember(m.id)} testID={`member-toggle-${m.id}`}>
                        <View style={[s.shareAvatar, selected && s.shareAvatarSelected]}>
                          <Text style={[s.shareInitial, selected && { color: C.bg }]}>
                            {(m.display_name || '?')[0].toUpperCase()}
                          </Text>
                          {selected && (
                            <View style={s.checkBadge}>
                              <MaterialIcons name="check" size={10} color={C.bg} />
                            </View>
                          )}
                        </View>
                        <Text style={[s.shareName, selected && { color: C.white }]}>
                          {m.display_name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          )
        )}

        {/* Category */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <MaterialIcons name="category" size={20} color={C.slate400} />
            <Text style={s.sectionLabel}>Category</Text>
          </View>
          <View style={s.categoryGrid}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                style={[s.categoryBtn, category === cat.id && s.categoryBtnActive]}
                onPress={() => setCategory(cat.id)}
              >
                <MaterialIcons
                  name={cat.icon as keyof typeof MaterialIcons.glyphMap}
                  size={20}
                  color={category === cat.id ? C.bg : C.slate400}
                />
                <Text style={[s.categoryText, category === cat.id && { color: C.bg }]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={s.addReceiptBtn}>
          <MaterialIcons name="add-a-photo" size={20} color={C.slate400} />
          <Text style={s.addReceiptText}>Add receipt photo</Text>
        </Pressable>
      </ScrollView>

      {/* Save button */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.saveBtn, pressed && { opacity: 0.85 }, !canSave && { opacity: 0.4 }]}
          onPress={handleSave}
          disabled={!canSave || saving}
          testID="save-expense-button"
        >
          {saving ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <MaterialIcons name="check" size={20} color={C.bg} />
              <Text style={s.saveBtnText}>Save Expense</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* ── Group picker modal ─────────────────────────────── */}
      <Modal
        visible={groupPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setGroupPickerOpen(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setGroupPickerOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Select Group</Text>
            <FlatList
              data={groups}
              keyExtractor={(item: GroupOption) => item.id}
              testID="group-list"
              renderItem={({ item, index }: { item: GroupOption; index: number }) => {
                const isSelected = item.id === groupId;
                return (
                  <TouchableOpacity
                    style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                    onPress={() => handleGroupSelect(item)}
                    activeOpacity={0.7}
                    testID={`group-option-${index}`}
                  >
                    <View style={[s.groupIcon, { backgroundColor: item.bg_color }]}>
                      <MaterialIcons
                        name={(item.icon_name as keyof typeof MaterialIcons.glyphMap) ?? 'group'}
                        size={20}
                        color={C.primary}
                      />
                    </View>
                    <Text style={[s.pickerRowText, isSelected && { color: C.primary }]}>
                      {item.name}
                    </Text>
                    {isSelected && (
                      <MaterialIcons name="check" size={20} color={C.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={s.separator} />}
              scrollEnabled={false}
            />
          </View>
        </Pressable>
      </Modal>

      {/* ── Currency picker modal ──────────────────────────── */}
      <Modal
        visible={currencyPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCurrencyPickerOpen(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setCurrencyPickerOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Expense Currency</Text>
            <FlatList
              data={CURRENCIES}
              keyExtractor={(item: Currency) => item.code}
              renderItem={({ item }: { item: Currency }) => {
                const isSelected = item.code === expenseCurrency.code;
                return (
                  <TouchableOpacity
                    style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                    onPress={() => { setExpenseCurrency(item); setCurrencyPickerOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.currencyFlag}>{item.flag}</Text>
                    <View style={s.currencyInfo}>
                      <Text style={[s.currencyCode, isSelected && { color: C.primary }]}>{item.code}</Text>
                      <Text style={s.currencyName}>{item.name}</Text>
                    </View>
                    <Text style={[s.currencySymbolText, isSelected && { color: C.primary }]}>
                      {item.symbol.trim()}
                    </Text>
                    {isSelected && (
                      <MaterialIcons name="check" size={20} color={C.primary} style={{ marginLeft: 8 }} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={s.separator} />}
              scrollEnabled={false}
            />
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.surfaceHL },
  headerBtn: { padding: 4, minWidth: 56 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 17 },
  cancelText: { color: C.slate400, fontSize: 16 },
  saveText: { color: C.primary, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  scrollContent: { paddingBottom: 120 },
  // Group selector row
  groupRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.surfaceHL, paddingHorizontal: 16, paddingVertical: 14 },
  groupRowText: { flex: 1, color: C.white, fontSize: 16, fontWeight: '600' },
  groupRowPlaceholder: { color: C.slate500, fontWeight: '400' },
  // Input rows
  inputRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.surfaceHL, paddingHorizontal: 16, paddingVertical: 4 },
  amountRow: { paddingVertical: 8 },
  inputIcon: { width: 36, alignItems: 'center' },
  input: { flex: 1, color: C.white, fontSize: 17, paddingVertical: 14 },
  amountInput: { fontSize: 32, fontWeight: '700' },
  currencyBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.surfaceHL, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginRight: 8, borderWidth: 1, borderColor: C.primary + '55' },
  currencyBadgeFlag: { fontSize: 16 },
  currencyBadgeCode: { color: C.primary, fontWeight: '700', fontSize: 13 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 10 },
  errorText: { color: C.orange, fontSize: 13 },
  // Sections
  section: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionLabel: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  memberPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paidPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surface, borderRadius: 999, borderWidth: 1, borderColor: C.surfaceHL },
  paidPillActive: { borderColor: C.primary, backgroundColor: 'rgba(23,232,107,0.1)' },
  paidInitial: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center' },
  paidInitialActive: { backgroundColor: C.primary },
  paidInitialText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  paidName: { color: C.slate400, fontWeight: '600', fontSize: 14 },
  splitRow: { flexDirection: 'row', gap: 8 },
  splitBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.surfaceHL },
  splitBtnActive: { backgroundColor: 'rgba(23,232,107,0.15)', borderColor: C.primary },
  splitBtnText: { color: C.slate400, fontWeight: '600', fontSize: 13 },
  splitBtnTextActive: { color: C.primary },
  shareGrid: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  shareItem: { alignItems: 'center', gap: 6 },
  shareAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.surface, borderWidth: 2, borderColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  shareAvatarSelected: { backgroundColor: 'rgba(23,232,107,0.2)', borderColor: C.primary },
  shareInitial: { color: C.slate400, fontWeight: '700', fontSize: 18 },
  checkBadge: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  shareName: { color: C.slate400, fontSize: 12, fontWeight: '600' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.surfaceHL },
  categoryBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  categoryText: { color: C.slate400, fontSize: 13, fontWeight: '600' },
  splitComingSoon: { color: C.slate500, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  addReceiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, margin: 16, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: C.surfaceHL, borderStyle: 'dashed' },
  addReceiptText: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.surfaceHL, backgroundColor: C.bg },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16 },
  saveBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingHorizontal: 20 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.surfaceHL, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { color: C.white, fontSize: 17, fontWeight: '700', marginBottom: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderRadius: 10, paddingHorizontal: 4 },
  pickerRowSelected: { backgroundColor: 'rgba(23,232,107,0.08)' },
  pickerRowText: { flex: 1, color: C.white, fontSize: 15, fontWeight: '600' },
  groupIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  currencyFlag: { fontSize: 26, marginRight: 2 },
  currencyInfo: { flex: 1 },
  currencyCode: { color: C.white, fontSize: 15, fontWeight: '600' },
  currencyName: { color: C.slate400, fontSize: 12, marginTop: 1 },
  currencySymbolText: { color: C.slate400, fontSize: 14, fontWeight: '500' },
  separator: { height: 1, backgroundColor: C.surfaceHL, marginHorizontal: 4 },
});
