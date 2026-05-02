import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/context/auth';
import { formatCentsWithCurrency } from '@/context/currency';
import { useToast } from '@/context/toast';
import { type CurrencyBalance, deriveBalanceStatus, sortBalancesDesc } from '@/lib/balance-utils';
import { shareExpenseCsv } from '@/lib/export-csv';
import { supabase } from '@/lib/supabase';
import { dispatchPendingPushNotifications } from '@/lib/push-notifications';
import { APP_STORE_URL, INVITE_WEB_LINK_BASE } from '@/lib/app-config';
import ExpenseDetailSheet, { Expense, ExpenseSplit, GroupMember } from '@/components/ExpenseDetailSheet';
import GroupSettingsSheet from '@/components/GroupSettingsSheet';
import GroupRenameModal from '@/components/GroupRenameModal';
import GroupDeleteModal from '@/components/GroupDeleteModal';
import GroupMembersSection from '@/components/GroupMembersSection';

const C = {
  primary: '#17e86b',
  orange: '#f97316',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  white: '#ffffff',
};

interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  balances: CurrencyBalance[];
  created_by: string | null;
  archived: boolean;
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
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);

  // Expense detail sheet
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);
  const [splitsLoading, setSplitsLoading] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState(false);

  // Members
  const [remindingId, setRemindingId] = useState<string | null>(null);

  // Settings sheet
  const [showSettings, setShowSettings] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Rename modal
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete / leave modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const fetchGroup = useCallback(async () => {
    if (!user || !id) return;
    const [
      { data, error: groupErr },
      { data: bal },
      { data: expRows, error: expErr },
      { data: memberRows, error: memberRowsErr },
    ] = await Promise.all([
      supabase
        .from('groups')
        .select('id, name, description, image_url, created_by, archived')
        .eq('id', id)
        .single(),
      supabase
        .from('group_balances')
        .select('balance_cents, currency_code')
        .eq('group_id', id)
        .eq('user_id', user.id),
      supabase.rpc('get_group_expenses', { p_group_id: id, p_user_id: user.id }),
      supabase.from('group_members').select('id, display_name, avatar_url, user_id').eq('group_id', id),
    ]);

    if (groupErr || !data) {
      setFetchError(groupErr?.message ?? t('group.notFound'));
      setLoading(false);
      return;
    }
    if (expErr) { setFetchError(expErr.message); setLoading(false); return; }
    if (memberRowsErr) { setFetchError(memberRowsErr.message ?? 'Failed to load group members.'); setLoading(false); return; }

    type RawBalance = { balance_cents: number; currency_code: string };
    const balances: CurrencyBalance[] = sortBalancesDesc(
      (Array.isArray(bal) ? (bal as RawBalance[]) : [])
        .filter((b) => b.balance_cents !== 0)
        .map((b) => ({ currency_code: b.currency_code, balance_cents: Number(b.balance_cents) })),
    );

    setGroup({ ...data, balances, archived: data.archived ?? false });

    const seen = new Set<string>();
    setExpenses(
      ((expRows as Expense[]) ?? []).filter((e) => {
        if (seen.has(e.expense_id)) return false;
        seen.add(e.expense_id);
        return true;
      }),
    );

    const rawMembers = (memberRows as GroupMember[]) ?? [];
    const needingProfile = rawMembers.filter((m) => m.user_id && !m.display_name).map((m) => m.user_id!);
    let profileMap: Record<string, { name: string; avatar_url: string | null }> = {};
    if (needingProfile.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', needingProfile);
      profileMap = (profiles ?? []).reduce(
        (acc, p) => ({ ...acc, [p.id]: { name: p.name ?? t('group.unknownMember'), avatar_url: p.avatar_url } }),
        {} as Record<string, { name: string; avatar_url: string | null }>,
      );
    }
    setMembers(
      rawMembers.map((m) =>
        m.user_id && !m.display_name && profileMap[m.user_id]
          ? { ...m, display_name: profileMap[m.user_id].name, avatar_url: m.avatar_url ?? profileMap[m.user_id].avatar_url }
          : m,
      ),
    );
    setLoading(false);
  }, [id, user, t]);

  useFocusEffect(useCallback(() => { fetchGroup(); }, [fetchGroup]));

  // Fetch per-member splits when an expense is selected
  useEffect(() => {
    if (!selectedExpense) { setSplits([]); setSplitsLoading(false); return; }
    let cancelled = false;
    setSplitsLoading(true);
    setSplits([]);
    supabase
      .from('expense_splits')
      .select('member_id, amount_cents')
      .eq('expense_id', selectedExpense.expense_id)
      .then(({ data, error }) => {
        if (!cancelled) {
          if (!error) setSplits((data as ExpenseSplit[]) ?? []);
          setSplitsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedExpense?.expense_id]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const leaveGroup = useCallback(async () => {
    if (!group || !user) return undefined;
    const { error } = await supabase.rpc('leave_group', { p_group_id: group.id });
    if (!error) dispatchPendingPushNotifications();
    return error;
  }, [group, user]);

  const handleRemind = useCallback(async (member: GroupMember) => {
    if (!id || !user || !group) return;
    setRemindingId(member.id);
    try {
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await supabase.from('invitations').insert({ inviter_id: user.id, group_id: id, token, status: 'pending' });
      const link = `${INVITE_WEB_LINK_BASE}?token=${encodeURIComponent(token)}`;
      const name = member.display_name ?? t('group.unknownMember');
      await Share.share({
        message: t('group.remindMessage', { name, groupName: group.name, link, appStoreUrl: APP_STORE_URL }),
      });
    } catch {
      // share cancelled — no action needed
    } finally {
      setRemindingId(null);
    }
  }, [id, user, group, t]);

  const handleRemoveMember = useCallback(async (member: GroupMember) => {
    if (!id) return;
    // For app members, check outstanding balance before removing
    if (member.user_id) {
      const { data: bal } = await supabase
        .from('group_balances')
        .select('balance_cents')
        .eq('group_id', id)
        .eq('user_id', member.user_id);
      const hasBalance = (bal ?? []).some((b: { balance_cents: number }) => b.balance_cents !== 0);
      if (hasBalance) {
        const name = member.display_name ?? t('group.unknownMember');
        Alert.alert(t('group.removeMemberTitle'), t('group.removeMemberBalanceBlocked', { name }));
        return;
      }
    }
    const { error } = await supabase.rpc('remove_group_member', { p_member_id: member.id });
    if (error) { Alert.alert(t('common.ok'), error.message); return; }
    dispatchPendingPushNotifications();
    showToast('success', t('toast.memberRemoved'));
    fetchGroup();
  }, [id, fetchGroup, showToast, t]);

  const handleArchive = useCallback(async () => {
    if (!group) return;
    setActionLoading(true);
    setActionError(null);
    const isCreator = !group.created_by || user?.id === group.created_by;
    if (!isCreator) {
      const status = deriveBalanceStatus(group.balances);
      if (status !== 'settled') {
        setActionError(status === 'owed' ? t('group.owedLeaveBlocked') : t('group.owesLeaveBlocked'));
        setActionLoading(false);
        return;
      }
      const error = await leaveGroup();
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    } else {
      const { error } = await supabase.from('groups').update({ archived: true }).eq('id', group.id);
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    }
    setShowSettings(false);
    router.replace('/');
  }, [group, user, leaveGroup, t]);

  const handleUnarchive = useCallback(async () => {
    if (!group) return;
    setActionLoading(true);
    setActionError(null);
    const { error } = await supabase.from('groups').update({ archived: false }).eq('id', group.id);
    setActionLoading(false);
    if (error) { setActionError(error.message); return; }
    setShowSettings(false);
    fetchGroup();
  }, [group, fetchGroup]);

  const handleExportCsv = useCallback(async () => {
    if (!group || expenses.length === 0) return;
    setExporting(true);
    try {
      await shareExpenseCsv(group.name, expenses);
    } catch {
      // share cancelled or failed — no action needed
    } finally {
      setExporting(false);
    }
  }, [group, expenses]);

  const handleRename = useCallback(async () => {
    if (!group || !renameInput.trim()) return;
    setRenameLoading(true);
    setRenameError(null);
    const { error } = await supabase.from('groups').update({ name: renameInput.trim() }).eq('id', group.id);
    setRenameLoading(false);
    if (error) { setRenameError(error.message); return; }
    setShowRenameModal(false);
    showToast('success', t('toast.groupRenamed'));
    fetchGroup();
  }, [group, renameInput, fetchGroup, showToast, t]);

  const handleDelete = useCallback(async () => {
    if (!group || deleteInput !== group.name) return;
    setActionLoading(true);
    setActionError(null);
    const isCreator = !group.created_by || user?.id === group.created_by;
    if (!isCreator) {
      const status = deriveBalanceStatus(group.balances);
      if (status !== 'settled') {
        setActionError(status === 'owed' ? t('group.owedLeaveBlocked') : t('group.owesLeaveBlocked'));
        setActionLoading(false);
        return;
      }
      const error = await leaveGroup();
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
    } else {
      const { error } = await supabase.rpc('delete_group', { p_group_id: group.id });
      setActionLoading(false);
      if (error) { setActionError(error.message); return; }
      dispatchPendingPushNotifications();
    }
    setShowDeleteModal(false);
    router.replace('/');
  }, [group, deleteInput, user, leaveGroup, t]);

  const handleDeleteExpense = useCallback(() => {
    if (!selectedExpense) return;
    const name = selectedExpense.description;
    Alert.alert(
      t('group.deleteExpenseTitle'),
      t('group.deleteExpenseMessage', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingExpense(true);
            const { error } = await supabase.rpc('delete_expense', { p_expense_id: selectedExpense.expense_id });
            if (error) { setDeletingExpense(false); Alert.alert(t('common.ok'), error.message); return; }
            dispatchPendingPushNotifications();
            setDeletingExpense(false);
            setSelectedExpense(null);
            showToast('success', t('toast.expenseDeleted'));
            fetchGroup();
          },
        },
      ],
    );
  }, [selectedExpense, fetchGroup, showToast, t]);

  const handleEditExpense = useCallback(() => {
    if (!selectedExpense) return;
    setSelectedExpense(null);
    router.push({ pathname: '/add-expense', params: { expenseId: selectedExpense.expense_id, groupId: id, groupName: group?.name ?? '' } });
  }, [selectedExpense, id, group]);

  // ─── Derived state ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[s.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]} testID="group-detail-screen">
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  if (!group) {
    return (
      <View style={[s.container, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]} testID="group-detail-screen">
        <Text style={{ color: C.slate400 }}>{fetchError ?? t('group.notFound')}</Text>
      </View>
    );
  }

  const balanceStatus = deriveBalanceStatus(group.balances);
  const grouped = groupByMonth(expenses);
  const isCreator = !group.created_by || user?.id === group.created_by;
  const canLeave = balanceStatus === 'settled';
  const leaveBlockedReason = balanceStatus === 'owed' ? t('group.owedLeaveBlocked') : t('group.owesLeaveBlocked');

  return (
    <View style={[s.container, { paddingTop: insets.top }]} testID="group-detail-screen">
      {/* Top bar */}
      <View style={s.topBar}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <Text style={s.topTitle} numberOfLines={1} testID="group-detail-title">
          {group.name}
        </Text>
        <Pressable style={s.backBtn} onPress={() => setShowSettings(true)} testID="settings-button">
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
            <Text style={s.coverBalanceLabel}>{t('group.totalBalance')}</Text>
            {balanceStatus === 'settled' ? (
              <Text style={[s.coverBalance, { color: C.slate400 }]}>{t('group.allSettled')}</Text>
            ) : (
              group.balances.map((b) => (
                <Text
                  key={b.currency_code}
                  style={[s.coverBalance, { color: b.balance_cents > 0 ? C.primary : C.orange }]}
                >
                  {b.balance_cents > 0
                    ? t('group.youAreOwed', { amount: formatCentsWithCurrency(b.balance_cents, b.currency_code) })
                    : t('group.youOwe', { amount: formatCentsWithCurrency(Math.abs(b.balance_cents), b.currency_code) })}
                </Text>
              ))
            )}
          </View>
        </View>

        {/* Action buttons */}
        <View style={s.actions}>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionPrimary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/group/balances', params: { groupId: id, groupName: group.name } })}
          >
            <MaterialIcons name="payments" size={20} color={C.bg} />
            <Text style={s.actionPrimaryText}>{t('group.settleUp')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionSecondary, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/group/balances', params: { groupId: id, groupName: group.name } })}
          >
            <MaterialIcons name="analytics" size={20} color={C.primary} />
            <Text style={s.actionSecondaryText}>{t('group.balances')}</Text>
          </Pressable>
        </View>
        <View style={s.actionsBottom}>
          <Pressable
            style={({ pressed }: { pressed: boolean }) => [s.actionBtn, s.actionSecondary, { flex: 1 }, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/invite-friend', params: { groupId: id, groupName: group.name } })}
            testID="invite-member-button"
          >
            <MaterialIcons name="person-add" size={20} color={C.white} />
            <Text style={s.actionSecondaryText}>{t('group.addMember')}</Text>
          </Pressable>
        </View>

        {/* Members section */}
        <GroupMembersSection
          members={members}
          currentUserId={user?.id ?? ''}
          isCreator={isCreator}
          remindingId={remindingId}
          onRemind={handleRemind}
          onRemoveMember={handleRemoveMember}
        />

        {/* Expenses section */}
        <View style={s.expensesHeader}>
          <Text style={s.expensesTitle}>{t('group.expenses')}</Text>
          <Pressable
            testID="spending-link"
            onPress={() => router.push({ pathname: '/group/spending', params: { groupId: id, groupName: group.name } })}
          >
            <Text style={s.viewAll}>{t('group.spending')}</Text>
          </Pressable>
        </View>

        {grouped.length === 0 && (
          <View style={s.empty}>
            <MaterialIcons name="receipt-long" size={48} color={C.surfaceHL} />
            <Text style={s.emptyText}>{t('group.noExpenses')}</Text>
          </View>
        )}

        {grouped.map(([month, items]) => (
          <View key={month}>
            <Text style={s.monthLabel}>{month.toUpperCase()}</Text>
            {items.map((expense) => {
              const isSettlement = expense.category === 'settlement';
              if (isSettlement) {
                const payerLabel = expense.paid_by_is_user ? t('expense.you') : expense.paid_by_name;
                const payeeLabel = expense.payee_name ?? '';
                return (
                  <View key={expense.expense_id} style={s.expenseCard}>
                    <View style={[s.expenseIcon, { backgroundColor: 'rgba(23,232,107,0.15)' }]}>
                      <MaterialIcons name="payments" size={22} color={C.primary} />
                    </View>
                    <View style={s.expenseInfo}>
                      <Text style={s.expenseName} numberOfLines={1}>
                        {t('group.settlementLine', { payer: payerLabel, payee: payeeLabel })}
                      </Text>
                      <Text style={s.expensePaid}>
                        {formatCentsWithCurrency(expense.total_amount_cents, expense.currency_code)}
                      </Text>
                    </View>
                    <View style={s.expenseRight}>
                      <Text style={[s.expenseLabel, { color: C.primary }]}>
                        {t('activity.settled')}
                      </Text>
                    </View>
                  </View>
                );
              }
              const cat = CATEGORY_ICONS[expense.category] ?? CATEGORY_ICONS.receipt;
              const youPositive = expense.paid_by_is_user;
              const youCents = expense.paid_by_is_user
                ? expense.total_amount_cents - expense.your_split_cents
                : expense.your_split_cents;
              const paidLabel = expense.paid_by_is_user ? t('expense.you') : expense.paid_by_name;
              return (
                <Pressable
                  key={expense.expense_id}
                  style={({ pressed }: { pressed: boolean }) => [s.expenseCard, pressed && { opacity: 0.8 }]}
                  onPress={() => setSelectedExpense(expense)}
                >
                  <View style={[s.expenseIcon, { backgroundColor: cat.bg }]}>
                    <MaterialIcons name={cat.icon as keyof typeof MaterialIcons.glyphMap} size={22} color={cat.color} />
                    <View style={[s.expenseDot, { backgroundColor: youPositive ? C.primary : C.orange }]} />
                  </View>
                  <View style={s.expenseInfo}>
                    <Text style={s.expenseName} numberOfLines={1}>{expense.description}</Text>
                    <Text style={s.expensePaid}>
                      {t('group.paidAmount', { name: paidLabel, amount: formatCentsWithCurrency(expense.total_amount_cents, expense.currency_code) })}
                    </Text>
                  </View>
                  <View style={s.expenseRight}>
                    {balanceStatus === 'settled' && !youPositive ? (
                      <Text style={[s.expenseLabel, { color: C.slate400 }]}>{t('activity.settled')}</Text>
                    ) : (
                      <>
                        <Text style={[s.expenseLabel, { color: youPositive ? C.primary : C.orange }]}>
                          {youPositive ? t('group.youLent') : t('group.youOweShort')}
                        </Text>
                        <Text style={[s.expenseAmount, { color: youPositive ? C.primary : C.orange }]}>
                          {formatCentsWithCurrency(youCents, expense.currency_code)}
                        </Text>
                      </>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}

        {!group.archived && (
          <Pressable
            style={s.addExpenseRow}
            onPress={() => router.push({ pathname: '/add-expense', params: { groupId: id, groupName: group.name } })}
          >
            <MaterialIcons name="add-circle-outline" size={22} color={C.primary} />
            <Text style={s.addExpenseText}>{t('group.addExpense')}</Text>
          </Pressable>
        )}
        {group.archived && (
          <View style={s.archivedBanner}>
            <MaterialIcons name="archive" size={16} color={C.slate400} />
            <Text style={s.archivedBannerText}>{t('group.archivedBanner')}</Text>
          </View>
        )}
      </ScrollView>

      {/* FAB — hidden for archived groups */}
      {!group.archived && (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.fab, pressed && { opacity: 0.85 }]}
          onPress={() => router.push({ pathname: '/add-expense', params: { groupId: id, groupName: group.name } })}
        >
          <MaterialIcons name="add" size={28} color={C.bg} />
        </Pressable>
      )}

      {/* Expense detail sheet */}
      {selectedExpense && (
        <ExpenseDetailSheet
          expense={selectedExpense}
          splits={splits}
          splitsLoading={splitsLoading}
          deletingExpense={deletingExpense}
          members={members}
          currentUserId={user?.id ?? ''}
          isArchived={group?.archived ?? false}
          onClose={() => setSelectedExpense(null)}
          onEdit={handleEditExpense}
          onDelete={handleDeleteExpense}
          format={(cents) => formatCentsWithCurrency(cents, selectedExpense.currency_code)}
        />
      )}

      {/* Settings bottom sheet */}
      <GroupSettingsSheet
        visible={showSettings}
        isCreator={isCreator}
        isArchived={group.archived}
        hasExpenses={expenses.length > 0}
        actionLoading={actionLoading}
        actionError={actionError}
        exporting={exporting}
        onClose={() => { setShowSettings(false); setActionError(null); }}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onExportCsv={handleExportCsv}
        onRename={() => {
          setShowSettings(false);
          setRenameInput(group.name);
          setRenameError(null);
          setShowRenameModal(true);
        }}
        onDeletePress={() => { setShowSettings(false); setShowDeleteModal(true); }}
        onLeavePress={() => {
          if (!canLeave) { setActionError(leaveBlockedReason); return; }
          setShowSettings(false);
          setShowDeleteModal(true);
        }}
      />

      {/* Rename modal */}
      <GroupRenameModal
        visible={showRenameModal}
        value={renameInput}
        loading={renameLoading}
        error={renameError}
        onChange={setRenameInput}
        onSave={handleRename}
        onClose={() => { setShowRenameModal(false); setRenameError(null); }}
      />

      {/* Delete / leave modal */}
      <GroupDeleteModal
        visible={showDeleteModal}
        isCreator={isCreator}
        groupName={group.name}
        confirmInput={deleteInput}
        loading={actionLoading}
        error={actionError}
        onConfirmInputChange={setDeleteInput}
        onConfirm={handleDelete}
        onClose={() => { setShowDeleteModal(false); setDeleteInput(''); setActionError(null); }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8 },
  backBtn: { padding: 10 },
  topTitle: { flex: 1, color: C.white, fontWeight: '700', fontSize: 18, textAlign: 'center' },
  scrollContent: { paddingBottom: 100 },
  coverWrap: { marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: 'hidden', height: 180 },
  coverImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  coverOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  coverContent: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  coverBalanceLabel: {
    color: C.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  coverBalance: { fontSize: 28, fontWeight: '700', color: C.white },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 24 },
  actionsBottom: { paddingHorizontal: 16, marginBottom: 24 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 14 },
  actionPrimary: { backgroundColor: C.primary },
  actionPrimaryText: { color: C.bg, fontWeight: '700', fontSize: 15 },
  actionSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.surfaceHL },
  actionSecondaryText: { color: C.white, fontWeight: '600', fontSize: 15 },
  expensesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  expensesTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  viewAll: { color: C.primary, fontSize: 13, fontWeight: '600' },
  monthLabel: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },
  expenseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  expenseIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  expenseDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.bg,
  },
  expenseInfo: { flex: 1 },
  expenseName: { color: C.white, fontWeight: '700', fontSize: 14, marginBottom: 2 },
  expensePaid: { color: C.slate400, fontSize: 12 },
  expenseRight: { alignItems: 'flex-end' },
  expenseLabel: { fontSize: 11, fontWeight: '600' },
  expenseAmount: { fontSize: 15, fontWeight: '700' },
  addExpenseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, marginTop: 4 },
  addExpenseText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  archivedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, marginTop: 4 },
  archivedBannerText: { color: C.slate400, fontSize: 13, fontWeight: '500' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { color: C.slate400, fontSize: 15, fontWeight: '600' },
});
