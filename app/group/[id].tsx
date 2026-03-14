import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  bg: '#112117',
  bgOverlay: '#112117f2',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

interface Expense {
  expense_id: string;
  description: string;
  total_amount_cents: number;
  category: string;
  created_at: string;
  paid_by_name: string;
  paid_by_is_user: boolean;
  your_split_cents: number;
}

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  balance_cents: number;
  created_by: string | null;
}

const CATEGORY_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  restaurant: { icon: 'restaurant', bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  hotel: { icon: 'hotel', bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  train: { icon: 'train', bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
  store: { icon: 'local-convenience-store', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  receipt: { icon: 'receipt-long', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
};

function monthKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function groupByMonth(expenses: Expense[]) {
  const map: Record<string, Expense[]> = {};
  for (const e of expenses) {
    const key = monthKey(e.created_at);
    if (!map[key]) map[key] = [];
    map[key].push(e);
  }
  return Object.entries(map);
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchGroup = useCallback(async () => {
    if (!user || !id) return;
    const [{ data, error: groupErr }, { data: bal }, { data: expRows, error: expErr }] = await Promise.all([
      supabase.from('groups').select('id, name, description, image_url, created_by').eq('id', id).single(),
      supabase.from('group_balances').select('balance_cents').eq('group_id', id).eq('user_id', user.id).maybeSingle(),
      supabase.rpc('get_group_expenses', { p_group_id: id, p_user_id: user.id }),
    ]);

    if (groupErr || !data) {
      setFetchError(groupErr?.message ?? 'Group not found.');
      setLoading(false);
      return;
    }
    if (expErr) {
      setFetchError(expErr.message);
      setLoading(false);
      return;
    }
    setGroup({ ...data, balance_cents: bal?.balance_cents ?? 0 });
    const seen = new Set<string>();
    const deduped = ((expRows as Expense[]) ?? []).filter((e) => {
      if (seen.has(e.expense_id)) return false;
      seen.add(e.expense_id);
      return true;
    });
    setExpenses(deduped);
    setLoading(false);
  }, [id, user]);

  useEffect(() => { fetchGroup(); }, [fetchGroup]);

  const leaveGroup = useCallback(async () => {
    if (!group || !user) return;
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', group.id)
      .eq('user_id', user.id);
    return error;
  }, [group, user]);

  const handleDelete = useCallback(async () => {
    if (!group || deleteInput !== group.name) return;
    setActionLoading(true);
    setActionError(null);
    const groupIsCreator = !group.created_by || user?.id === group.created_by;
    if (!groupIsCreator) {
      const error = await leaveGroup();
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    } else {
      const { error } = await supabase
        .from('groups')
        .delete()
        .eq('id', group.id);
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    }
    setShowDeleteModal(false);
    router.replace('/');
  }, [group, deleteInput, user, leaveGroup]);

  const handleArchive = useCallback(async () => {
    if (!group) return;
    setActionLoading(true);
    setActionError(null);
    const groupIsCreator = !group.created_by || user?.id === group.created_by;
    if (!groupIsCreator) {
      const error = await leaveGroup();
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    } else {
      const { error } = await supabase
        .from('groups')
        .update({ archived: true })
        .eq('id', group.id);
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    }
    setShowSettings(false);
    router.replace('/');
  }, [group, user, leaveGroup]);

  if (loading) {
    return (
      <View
        style={[s.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}
        testID="group-detail-screen"
      >
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  if (!group) {
    return (
      <View
        style={[s.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}
        testID="group-detail-screen"
      >
        <Text style={{ color: C.slate400 }}>{fetchError ?? 'Group not found'}</Text>
      </View>
    );
  }

  const isOwed = group.balance_cents > 0;
  const balanceText = group.balance_cents === 0
    ? 'All settled up'
    : isOwed
      ? `You are owed ${format(group.balance_cents)}`
      : `You owe ${format(group.balance_cents)}`;

  const grouped = groupByMonth(expenses);
  const isCreator = !group.created_by || user?.id === group.created_by;

  return (
    <View style={[s.container, { paddingTop: insets.top }]} testID="group-detail-screen">
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1} testID="group-detail-title">{group.name}</Text>
        <Pressable
          style={s.backBtn}
          onPress={() => setShowSettings(true)}
          testID="settings-button"
        >
          <MaterialIcons name="settings" size={24} color={C.white} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Cover image / balance banner */}
        <View style={s.coverWrap}>
          {group.image_url ? (
            <Image source={{ uri: group.image_url }} style={s.coverImage} />
          ) : (
            <View style={[s.coverImage, { backgroundColor: C.surfaceHL }]} />
          )}
          <View style={s.coverOverlay} />
          <View style={s.coverContent}>
            <Text style={s.coverBalanceLabel}>Total Balance</Text>
            <Text style={[s.coverBalance, { color: group.balance_cents === 0 ? C.slate400 : isOwed ? C.primary : C.orange }]}>
              {balanceText}
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={s.actions}>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionPrimary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/group/balances', params: { groupId: id, groupName: group.name } })}
          >
            <MaterialIcons name="payments" size={20} color={C.bg} />
            <Text style={s.actionPrimaryText}>Settle up</Text>
          </Pressable>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionSecondary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/group/balances', params: { groupId: id, groupName: group.name } })}
          >
            <MaterialIcons name="analytics" size={20} color={C.primary} />
            <Text style={s.actionSecondaryText}>Balances</Text>
          </Pressable>
        </View>
        <View style={s.actionsBottom}>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionSecondary, { flex: 1 }, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/invite-friend', params: { groupId: id, groupName: group.name } })}
            testID="invite-member-button"
          >
            <MaterialIcons name="person-add" size={20} color={C.white} />
            <Text style={s.actionSecondaryText}>Add member</Text>
          </Pressable>
        </View>

        {/* Expenses section */}
        <View style={s.expensesHeader}>
          <Text style={s.expensesTitle}>Expenses</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/group/spending', params: { groupId: id, groupName: group.name } })}
          >
            <Text style={s.viewAll}>Spending →</Text>
          </Pressable>
        </View>

        {grouped.length === 0 && (
          <View style={s.empty}>
            <MaterialIcons name="receipt-long" size={48} color={C.surfaceHL} />
            <Text style={s.emptyText}>No expenses yet</Text>
          </View>
        )}

        {grouped.map(([month, items]) => (
          <View key={month}>
            <Text style={s.monthLabel}>{month.toUpperCase()}</Text>
            {items.map((expense) => {
              const cat = CATEGORY_ICONS[expense.category] ?? CATEGORY_ICONS.receipt;
              const youPositive = expense.paid_by_is_user;
              const youCents = expense.paid_by_is_user
                ? expense.total_amount_cents - expense.your_split_cents
                : expense.your_split_cents;
              const paidLabel = expense.paid_by_is_user ? 'You' : expense.paid_by_name;
              return (
                <Pressable key={expense.expense_id} style={({ pressed }: { pressed: boolean }) => [s.expenseCard, pressed && { opacity: 0.8 }]}>
                  <View style={[s.expenseIcon, { backgroundColor: cat.bg }]}>
                    <MaterialIcons name={cat.icon as keyof typeof MaterialIcons.glyphMap} size={22} color={cat.color} />
                    <View style={[s.expenseDot, { backgroundColor: youPositive ? C.primary : C.orange }]} />
                  </View>
                  <View style={s.expenseInfo}>
                    <Text style={s.expenseName} numberOfLines={1}>{expense.description}</Text>
                    <Text style={s.expensePaid}>{paidLabel} paid {format(expense.total_amount_cents)}</Text>
                  </View>
                  <View style={s.expenseRight}>
                    <Text style={[s.expenseLabel, { color: youPositive ? C.primary : C.orange }]}>
                      {youPositive ? 'you lent' : 'you owe'}
                    </Text>
                    <Text style={[s.expenseAmount, { color: youPositive ? C.primary : C.orange }]}>
                      {format(youCents)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* Add expense row */}
        <Pressable
          style={s.addExpenseRow}
          onPress={() => router.push({ pathname: '/add-expense', params: { groupId: id, groupName: group.name } })}
        >
          <MaterialIcons name="add-circle-outline" size={22} color={C.primary} />
          <Text style={s.addExpenseText}>Add an expense</Text>
        </Pressable>
      </ScrollView>

      {/* FAB */}
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [s.fab, pressed && { opacity: 0.85 }]}
        onPress={() => router.push({ pathname: '/add-expense', params: { groupId: id, groupName: group.name } })}
      >
        <MaterialIcons name="add" size={28} color={C.bg} />
      </Pressable>

      {/* Settings bottom sheet */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowSettings(false); setActionError(null); setDeleteInput(''); }}
      >
        <View style={s.settingsModalContainer}>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
            onPress={() => { setShowSettings(false); setActionError(null); }}
          />
          <View style={s.bottomSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Group Settings</Text>

            {actionError ? (
              <Text style={s.errorText}>{actionError}</Text>
            ) : null}

            {isCreator ? (
              <>
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.sheetRow, pressed && { opacity: 0.7 }]}
                  onPress={handleArchive}
                  disabled={actionLoading}
                >
                  <View style={[s.sheetIconWrap, { backgroundColor: 'rgba(249,115,22,0.12)' }]}>
                    <MaterialIcons name="inventory" size={20} color={C.orange} />
                  </View>
                  <Text style={s.sheetRowText}>Archive Group</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }: { pressed: boolean }) => [s.sheetRow, pressed && { opacity: 0.7 }]}
                  onPress={() => { setShowSettings(false); setShowDeleteModal(true); }}
                  disabled={actionLoading}
                >
                  <View style={[s.sheetIconWrap, { backgroundColor: 'rgba(255,82,82,0.12)' }]}>
                    <MaterialIcons name="delete-forever" size={20} color="#ff5252" />
                  </View>
                  <Text style={[s.sheetRowText, { color: '#ff5252' }]}>Delete Group</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [s.sheetRow, pressed && { opacity: 0.7 }]}
                onPress={() => { setShowSettings(false); setShowDeleteModal(true); }}
                disabled={actionLoading}
              >
                <View style={[s.sheetIconWrap, { backgroundColor: 'rgba(255,82,82,0.12)' }]}>
                  <MaterialIcons name="exit-to-app" size={20} color="#ff5252" />
                </View>
                <Text style={[s.sheetRowText, { color: '#ff5252' }]}>Leave Group</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* Type-to-confirm delete modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowDeleteModal(false); setDeleteInput(''); setActionError(null); }}
      >
        <View style={s.deleteOverlay}>
          <View style={s.deleteCard}>
            <View style={[s.sheetIconWrap, { backgroundColor: 'rgba(255,82,82,0.12)', alignSelf: 'center', marginBottom: 16 }]}>
              <MaterialIcons name="delete-forever" size={28} color="#ff5252" />
            </View>
            <Text style={s.deleteTitle}>{isCreator ? 'Delete Group' : 'Leave Group'}</Text>
            <Text style={s.deleteWarning}>
              {isCreator
                ? <>This will permanently delete{' '}<Text style={{ fontWeight: '700', color: C.white }}>{group?.name}</Text>{' '}and all its expenses. This cannot be undone.</>
                : <>You will be removed from{' '}<Text style={{ fontWeight: '700', color: C.white }}>{group?.name}</Text>. You can rejoin via an invite link.</>
              }
            </Text>
            <Text style={s.deleteLabel}>
              Type <Text style={{ fontWeight: '700', color: C.white }}>{group?.name}</Text> to confirm
            </Text>
            <TextInput
              style={s.deleteInput}
              value={deleteInput}
              onChangeText={setDeleteInput}
              placeholder={group?.name}
              placeholderTextColor={C.slate500}
              autoCapitalize="none"
              autoCorrect={false}
              testID="delete-confirm-input"
            />
            {actionError ? <Text style={s.errorText}>{actionError}</Text> : null}
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [
                s.deleteConfirmBtn,
                deleteInput !== group?.name && s.deleteConfirmBtnDisabled,
                pressed && deleteInput === group?.name && { opacity: 0.8 },
              ]}
              onPress={handleDelete}
              disabled={deleteInput !== group?.name || actionLoading}
              testID="delete-confirm-button"
            >
              <Text style={s.deleteConfirmBtnText}>
                {actionLoading ? (isCreator ? 'Deleting…' : 'Leaving…') : (isCreator ? 'Delete Group' : 'Leave Group')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [s.deleteCancelBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowDeleteModal(false); setDeleteInput(''); setActionError(null); }}
            >
              <Text style={s.deleteCancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  settingsModalContainer: { flex: 1, justifyContent: 'flex-end' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8 },
  backBtn: { padding: 10 },
  topTitle: { flex: 1, color: C.white, fontWeight: '700', fontSize: 18, textAlign: 'center' },
  scrollContent: { paddingBottom: 100 },
  coverWrap: { marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: 'hidden', height: 180 },
  coverImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  coverOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  coverContent: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  coverBalanceLabel: { color: C.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  coverBalance: { fontSize: 28, fontWeight: '700', color: C.white },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 24 },
  actionsBottom: { paddingHorizontal: 16, marginBottom: 24 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 14 },
  actionPrimary: { backgroundColor: C.primary },
  actionPrimaryText: { color: C.bg, fontWeight: '700', fontSize: 15 },
  actionSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.surfaceHL },
  actionSecondaryText: { color: C.white, fontWeight: '600', fontSize: 15 },
  expensesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  expensesTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  viewAll: { color: C.primary, fontSize: 13, fontWeight: '600' },
  monthLabel: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },
  expenseCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, backgroundColor: C.surface, borderRadius: 14, padding: 12, gap: 12, borderWidth: 1, borderColor: C.surfaceHL },
  expenseIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  expenseDot: { position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: C.bg },
  expenseInfo: { flex: 1 },
  expenseName: { color: C.white, fontWeight: '700', fontSize: 14, marginBottom: 2 },
  expensePaid: { color: C.slate400, fontSize: 12 },
  expenseRight: { alignItems: 'flex-end' },
  expenseLabel: { fontSize: 11, fontWeight: '600' },
  expenseAmount: { fontSize: 15, fontWeight: '700' },
  addExpenseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, marginTop: 4 },
  addExpenseText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  fab: { position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { color: C.slate400, fontSize: 15, fontWeight: '600' },
  bottomSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { color: C.white, fontWeight: '700', fontSize: 17, marginBottom: 20 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  sheetIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetRowText: { color: C.white, fontWeight: '600', fontSize: 15 },
  errorText: { color: '#ff5252', fontSize: 13, marginBottom: 8 },
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  deleteCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
  },
  deleteTitle: { color: C.white, fontWeight: '700', fontSize: 20, textAlign: 'center', marginBottom: 12 },
  deleteWarning: { color: C.slate400, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
  deleteLabel: { color: C.slate400, fontSize: 13, marginBottom: 8 },
  deleteInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.white,
    fontSize: 15,
    marginBottom: 16,
  },
  deleteConfirmBtn: {
    backgroundColor: '#ff5252',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  deleteConfirmBtnDisabled: { backgroundColor: C.surfaceHL },
  deleteConfirmBtnText: { color: C.white, fontWeight: '700', fontSize: 15 },
  deleteCancelBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteCancelBtnText: { color: C.slate400, fontWeight: '600', fontSize: 15 },
});
