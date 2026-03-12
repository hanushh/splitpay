import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
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
import { useCategoryCache } from '@/hooks/use-category-cache';
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

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: '🍽 Food & Drink',
  train: '🚗 Transport',
  hotel: '🏨 Accommodation',
  movie: '🎬 Entertainment',
  store: '🛍 Shopping',
  other: '⚙️ Other',
};

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
  const [paidByPickerOpen, setPaidByPickerOpen] = useState(false);
  const [splitMethod, setSplitMethod] = useState<'equally' | 'exact' | 'percent'>('equally');
  const [splitCustomized, setSplitCustomized] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const { detect, saveMapping, reinforceMapping } = useCategoryCache();
  const [detectedCategory, setDetectedCategory] = useState<string>('other');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);

  // Load only groups the current user is a member of
  useEffect(() => {
    if (!user) return;
    supabase
      .from('group_members')
      .select('groups!inner(id, name, icon_name, bg_color)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const seen = new Set<string>();
        const list = (data ?? [])
          .map((row: any) => row.groups as GroupOption)
          .filter(Boolean)
          .filter((g: GroupOption) => {
            if (seen.has(g.id)) return false;
            seen.add(g.id);
            return true;
          });
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

  // Auto-detect category from description with 300ms debounce
  useEffect(() => {
    if (!description.trim()) {
      setDetectedCategory('other');
      return;
    }
    const timer = setTimeout(() => {
      setDetectedCategory(detect(description));
    }, 300);
    return () => clearTimeout(timer);
  }, [description, detect]);

  // Clear custom category input when auto-detection finds a non-other category
  useEffect(() => {
    if (detectedCategory !== 'other') {
      setCustomCategory('');
    }
  }, [detectedCategory]);

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handlePickReceipt = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera roll permission is required to add a receipt photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setReceiptUploading(true);
    setError(null);

    try {
      // Compress and resize: max 1200px on the longest side, JPEG quality 0.7
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: Math.min(asset.width, 1200) } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );

      // Read the file as a Blob-compatible ArrayBuffer via fetch
      const fileResponse = await fetch(manipulated.uri);
      const blob = await fileResponse.blob();

      const ext = 'jpg';
      const timestamp = Date.now();
      // Path: <group_id>/<timestamp>.<ext>  (group_id used in storage RLS)
      const storagePath = `${groupId}/${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(storagePath, blob, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(storagePath);

      setReceiptUri(urlData.publicUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload receipt photo.');
    } finally {
      setReceiptUploading(false);
    }
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

    const finalCategory = detectedCategory === 'other' && customCategory.trim()
      ? customCategory.trim().toLowerCase()
      : detectedCategory;

    // Insert expense
    const { data: expense, error: expErr } = await supabase
      .from('expenses')
      .insert({
        group_id: groupId,
        description: description.trim(),
        amount_cents: amtCents,
        paid_by_member_id: paidBy,
        category: finalCategory,
        ...(receiptUri ? { receipt_url: receiptUri } : {}),
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
    // Fire-and-forget: reinforcement runs in background, does not block navigation.
    // The hook updates in-memory cache synchronously before the RPC completes.
    if (detectedCategory !== 'other') {
      reinforceMapping(description, detectedCategory);
    } else if (customCategory.trim()) {
      saveMapping(description, customCategory.trim().toLowerCase());
    }
    router.back();
  };

  const handleGroupSelect = (g: GroupOption) => {
    setGroupId(g.id);
    setGroupName(g.name);
    setGroupPickerOpen(false);
    setMembers([]);
    setSelectedMembers(new Set());
    setPaidBy('');
    setSplitCustomized(false);
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
              {/* Paid by — compact row, picker opens on tap */}
              {(() => {
                const payer = members.find((m) => m.id === paidBy);
                return (
                  <Pressable
                    style={({ pressed }: { pressed: boolean }) => [s.compactRow, pressed && { opacity: 0.7 }]}
                    onPress={() => setPaidByPickerOpen(true)}
                    testID="paid-by-section"
                  >
                    <MaterialIcons name="person" size={20} color={C.slate400} />
                    <Text style={s.compactRowLabel}>Paid by</Text>
                    <View style={s.compactRowValue}>
                      {payer && (
                        <View style={s.compactAvatar}>
                          <Text style={s.compactAvatarText}>
                            {(payer.display_name || '?')[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={s.compactRowValueText}>{payer?.display_name ?? '—'}</Text>
                    </View>
                    <Text style={s.compactChange}>Change</Text>
                    <MaterialIcons name="chevron-right" size={18} color={C.slate500} />
                  </Pressable>
                );
              })()}

              {/* Split — compact summary, expands to customise */}
              <View style={s.section}>
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.splitSummaryRow, pressed && { opacity: 0.7 }]}
                  onPress={() => setSplitCustomized((v) => !v)}
                  testID="split-summary-row"
                >
                  <MaterialIcons name="call-split" size={20} color={C.slate400} />
                  <Text style={s.compactRowLabel}>Split</Text>
                  <Text style={s.splitSummaryText}>
                    {splitMethod === 'equally'
                      ? `Equally · ${selectedMembers.size} member${selectedMembers.size !== 1 ? 's' : ''}`
                      : splitMethod === 'exact' ? 'Exact amounts' : 'By percent'}
                  </Text>
                  <Text style={s.compactChange}>{splitCustomized ? 'Done' : 'Customize'}</Text>
                  <MaterialIcons name={splitCustomized ? 'expand-less' : 'expand-more'} size={18} color={C.slate500} />
                </Pressable>

                {splitCustomized && (
                  <>
                    <View style={[s.splitRow, { marginTop: 12 }]}>
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
                    <View style={[s.shareGrid, { marginTop: 16 }]} testID="share-with-section">
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
                  </>
                )}
              </View>
            </>
          )
        )}

        {/* Category — auto-detected chip */}
        {description.trim().length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <MaterialIcons name="category" size={20} color={C.slate400} />
              <Text style={s.sectionLabel}>Category</Text>
            </View>
            <View style={s.categoryChipRow}>
              <View style={[s.categoryChip, detectedCategory === 'other' && s.categoryChipOther]}>
                <Text style={[s.categoryChipText, detectedCategory === 'other' && s.categoryChipTextOther]}>
                  {CATEGORY_LABELS[detectedCategory] ?? detectedCategory}
                </Text>
              </View>
              <Text style={s.categoryAutoLabel}>Auto-detected</Text>
            </View>
            {detectedCategory === 'other' && (
              <TextInput
                style={s.categoryInput}
                placeholder="e.g. Health & Wellness"
                placeholderTextColor={C.slate400}
                value={customCategory}
                onChangeText={setCustomCategory}
                returnKeyType="done"
                testID="custom-category-input"
              />
            )}
            {detectedCategory === 'other' && customCategory.trim().length > 0 && (
              <Text style={s.categorySaveHint}>Will be saved on expense creation</Text>
            )}
          </View>
        )}

        {receiptUri ? (
          <View style={s.receiptPreviewWrapper}>
            <Image
              source={{ uri: receiptUri }}
              style={s.receiptPreview}
              contentFit="cover"
            />
            <Pressable
              style={s.receiptRemoveBtn}
              onPress={() => setReceiptUri(null)}
              testID="remove-receipt-button"
            >
              <MaterialIcons name="close" size={16} color={C.white} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [
              s.addReceiptBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={handlePickReceipt}
            disabled={receiptUploading}
            testID="add-receipt-button"
          >
            {receiptUploading ? (
              <ActivityIndicator size="small" color={C.slate400} />
            ) : (
              <MaterialIcons name="add-a-photo" size={20} color={C.slate400} />
            )}
            <Text style={s.addReceiptText}>
              {receiptUploading ? 'Uploading…' : 'Add receipt photo'}
            </Text>
          </Pressable>
        )}
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

      {/* ── Paid-by picker modal ───────────────────────────── */}
      <Modal
        visible={paidByPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPaidByPickerOpen(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setPaidByPickerOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Who paid?</Text>
            {members.map((m) => {
              const isSelected = m.id === paidBy;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[s.pickerRow, isSelected && s.pickerRowSelected]}
                  onPress={() => { setPaidBy(m.id); setPaidByPickerOpen(false); }}
                  activeOpacity={0.7}
                  testID={`paid-by-${m.id}`}
                >
                  <View style={[s.paidInitial, isSelected && s.paidInitialActive]}>
                    <Text style={[s.paidInitialText, isSelected && { color: C.bg }]}>
                      {(m.display_name || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[s.pickerRowText, isSelected && { color: C.primary }]}>
                    {m.display_name}
                  </Text>
                  {isSelected && <MaterialIcons name="check" size={20} color={C.primary} />}
                </TouchableOpacity>
              );
            })}
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
  categoryChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: `rgba(23,232,107,0.12)`,
    borderWidth: 1, borderColor: `rgba(23,232,107,0.35)`,
  },
  categoryChipOther: {
    backgroundColor: `rgba(148,163,184,0.08)`,
    borderColor: `rgba(148,163,184,0.25)`,
  },
  categoryChipText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  categoryChipTextOther: { color: C.slate400 },
  categoryAutoLabel: { color: C.slate500, fontSize: 11 },
  categoryInput: {
    marginTop: 10, backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, color: C.white,
    fontSize: 14, borderWidth: 1, borderColor: C.surfaceHL,
  },
  categorySaveHint: { color: C.slate500, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  splitComingSoon: { color: C.slate500, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  addReceiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, margin: 16, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: C.surfaceHL, borderStyle: 'dashed' },
  addReceiptText: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  receiptPreviewWrapper: { margin: 16, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  receiptPreview: { width: '100%', height: 180, borderRadius: 12 },
  receiptRemoveBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
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
  // Compact rows (paid-by, split summary)
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.surfaceHL },
  compactRowLabel: { color: C.slate400, fontSize: 14, fontWeight: '600', minWidth: 52 },
  compactRowValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  compactRowValueText: { color: C.white, fontSize: 14, fontWeight: '600' },
  compactAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center' },
  compactAvatarText: { color: C.primary, fontWeight: '700', fontSize: 11 },
  compactChange: { color: C.primary, fontSize: 13, fontWeight: '600' },
  splitSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splitSummaryText: { flex: 1, color: C.white, fontSize: 14, fontWeight: '600' },
});
