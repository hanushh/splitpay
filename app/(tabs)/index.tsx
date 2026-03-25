import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';
import { formatCentsWithCurrency, useCurrency } from '@/context/currency';
import OnboardingTooltip from '@/components/ui/OnboardingTooltip';
import { APP_DISPLAY_NAME } from '@/lib/app-config';
import { type CurrencyBalance, sortBalancesDesc } from '@/lib/balance-utils';
import { Group, useGroups } from '@/hooks/use-groups';
import { useArchivedGroups } from '@/hooks/use-archived-groups';
import { useHomeOnboarding } from '@/hooks/use-home-onboarding';

const C = {
  primary: '#17e86b',
  primaryDark: '#0ea64c',
  danger: '#ff5252',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
  orange: '#f97316',
};

function GroupCard({ group }: { group: Group }) {
  const { t } = useTranslation();
  const amountColor = group.status === 'owes' ? C.orange : C.primary;
  const opacity = group.archived ? 0.7 : 1;
  const sortedBalances = sortBalancesDesc(group.balances);
  const primaryBalance = sortedBalances[0];
  const extraCount = sortedBalances.length - 1;

  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => [
        s.groupCard,
        { opacity: pressed ? 0.85 : opacity },
      ]}
      onPress={() =>
        router.push({ pathname: '/group/[id]', params: { id: group.id } })
      }
      testID={`group-card-${group.id}`}
    >
      <View style={s.groupIcon}>
        {group.image_url ? (
          <Image source={{ uri: group.image_url }} style={s.groupImage} />
        ) : (
          <MaterialIcons
            name={
              (group.icon_name as keyof typeof MaterialIcons.glyphMap) ??
              'group'
            }
            size={28}
            color={C.primary}
          />
        )}
      </View>

      <View style={s.groupInfo}>
        <Text style={s.groupName} numberOfLines={1}>
          {group.name}
        </Text>
        <View style={s.groupMeta}>
          {group.members.length > 0 && (
            <View style={s.memberStack}>
              {group.members.slice(0, 3).map((m, i) => {
                const initials = (m.display_name ?? '?')[0].toUpperCase();
                return m.avatar_url ? (
                  <Image
                    key={m.id}
                    source={{ uri: m.avatar_url }}
                    style={[s.memberAvatar, { marginLeft: i === 0 ? 0 : -8 }]}
                  />
                ) : (
                  <View
                    key={m.id}
                    style={[
                      s.memberAvatar,
                      s.memberAvatarInitials,
                      { marginLeft: i === 0 ? 0 : -8 },
                    ]}
                  >
                    <Text style={s.memberAvatarInitialsText}>{initials}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {group.description ? (
            <Text style={s.groupSubtitle} numberOfLines={1}>
              {group.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={s.groupAmount}>
        {group.status === 'settled' ? (
          <Text style={s.settledText}>{t('groups.settledUp')}</Text>
        ) : primaryBalance ? (
          <>
            <Text style={[s.amountLabel, { color: amountColor }]}>
              {group.status === 'owed'
                ? t('groups.youAreOwedShort')
                : t('groups.youOweShort')}
            </Text>
            <Text style={[s.amountValue, { color: amountColor }]}>
              {formatCentsWithCurrency(
                primaryBalance.balance_cents,
                primaryBalance.currency_code,
              )}
            </Text>
            {extraCount > 0 && (
              <Text style={s.andMoreText}>
                {t('groups.andMore', { count: extraCount })}
              </Text>
            )}
          </>
        ) : null}
      </View>

      <MaterialIcons name="chevron-right" size={22} color={C.surfaceHL} />
    </Pressable>
  );
}

function TotalBalanceDisplay({ balances }: { balances: CurrencyBalance[] }) {
  const { t } = useTranslation();
  const isSettled = balances.length === 0;
  const isMulti = balances.length > 1;
  const hasDebt = balances.some((b) => b.balance_cents < 0);
  const allOwed = balances.every((b) => b.balance_cents > 0);
  const allOwes = balances.every((b) => b.balance_cents < 0);

  const summaryLabel = allOwed
    ? t('groups.youAreOwedMulti')
    : allOwes
      ? t('groups.youOweMulti')
      : t('groups.mixedBalances');

  return (
    <View style={s.balanceCard}>
      <View style={s.balanceCardBg}>
        <MaterialIcons name="account-balance-wallet" size={64} color={C.white} />
      </View>
      <Text style={s.balanceLabel}>{t('groups.totalBalance')}</Text>
      {isSettled ? (
        <Text style={s.balanceAmount}>{t('groups.allSettled')}</Text>
      ) : isMulti ? (
        <>
          <Text style={[s.balanceAmount, hasDebt && !allOwes && { color: C.white }, allOwes && { color: C.orange }]}>
            {summaryLabel}
          </Text>
          <View style={s.currencyChips}>
            {balances.map((b) => (
              <View
                key={b.currency_code}
                style={[s.currencyChip, b.balance_cents < 0 && s.currencyChipDebt]}
              >
                <Text style={[s.currencyChipAmount, b.balance_cents < 0 && { color: C.orange }]}>
                  {formatCentsWithCurrency(Math.abs(b.balance_cents), b.currency_code)}
                </Text>
                <Text style={[s.currencyChipCode, b.balance_cents < 0 && { color: C.orange }]}>
                  {b.currency_code}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={[s.balanceAmount, hasDebt && { color: C.orange }]}>
          {balances[0].balance_cents > 0
            ? t('groups.youAreOwed', {
                amount: formatCentsWithCurrency(balances[0].balance_cents, balances[0].currency_code),
              })
            : t('groups.youOwe', {
                amount: formatCentsWithCurrency(Math.abs(balances[0].balance_cents), balances[0].currency_code),
              })}
        </Text>
      )}
      <View style={s.balanceTrend}>
        <MaterialIcons
          name={!hasDebt ? 'trending-up' : 'trending-down'}
          size={14}
          color={!hasDebt ? C.primary : C.orange}
        />
        <Text style={[s.balanceTrendText, hasDebt && { color: C.orange }]}>
          {!isSettled ? t('groups.acrossActive') : t('groups.acrossAll')}
        </Text>
      </View>
    </View>
  );
}

type StatusFilter = 'all' | 'owed' | 'owes' | 'settled';

export default function GroupsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { groups, loading, error, refetch, totalBalances } = useGroups();
  const {
    groups: archivedGroups,
    loading: archivedLoading,
    fetch: fetchArchived,
  } = useArchivedGroups();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const searchInputRef = useRef<React.ElementRef<typeof TextInput>>(null);

  const {
    tooltipProps,
    balanceCardRef,
    createGroupBtnRef,
    fabRef,
    measureBalanceCard,
    measureCreateGroupBtn,
    measureFab,
  } = useHomeOnboarding();

  const statusFilters = useMemo(
    () => [
      { key: 'all' as const, label: t('groups.filterAll') },
      { key: 'owed' as const, label: t('groups.filterOwed') },
      { key: 'owes' as const, label: t('groups.filterOwe') },
      { key: 'settled' as const, label: t('groups.filterSettled') },
    ],
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const visibleGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return groups.filter((g) => {
      const matchesQuery = q === '' || g.name.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || g.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [groups, searchQuery, statusFilter]);

  const handleSearchToggle = useCallback(() => {
    if (showSearch) {
      setShowSearch(false);
      setSearchQuery('');
    } else {
      setShowSearch(true);
      setTimeout(
        () =>
          (searchInputRef.current as { focus?: () => void } | null)?.focus?.(),
        50,
      );
    }
  }, [showSearch]);

  const handleArchivedToggle = useCallback(() => {
    if (!archivedExpanded) {
      fetchArchived();
    }
    setArchivedExpanded((v) => !v);
  }, [archivedExpanded, fetchArchived]);

  const avatarLetter = user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <View
      style={[s.container, { paddingTop: insets.top }]}
      testID="groups-screen"
    >
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        {showSearch ? (
          <View style={s.searchRow}>
            <MaterialIcons
              name="search"
              size={20}
              color={C.slate400}
              style={{ marginLeft: 4 }}
            />
            <TextInput
              ref={searchInputRef}
              style={s.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('groups.searchPlaceholder')}
              placeholderTextColor={C.slate500}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
            />
            <Pressable
              onPress={handleSearchToggle}
              hitSlop={8}
              style={s.iconBtn}
            >
              <MaterialIcons name="close" size={22} color={C.slate400} />
            </Pressable>
          </View>
        ) : (
          <View style={s.headerTop}>
            <View style={s.headerLeft}>
              <View style={s.avatar}>
                <Text style={s.avatarLetter}>{avatarLetter}</Text>
              </View>
              <Text style={s.appTitle}>{APP_DISPLAY_NAME}</Text>
            </View>
            <View style={s.headerIcons}>
              <Pressable
                style={s.iconBtn}
                hitSlop={8}
                onPress={handleSearchToggle}
              >
                <MaterialIcons name="search" size={24} color={C.slate400} />
              </Pressable>
              <View ref={createGroupBtnRef} onLayout={measureCreateGroupBtn}>
                <Pressable
                  style={s.iconBtn}
                  hitSlop={8}
                  onPress={() => router.push('/create-group')}
                  testID="create-group-header-btn"
                >
                  <MaterialIcons name="group-add" size={24} color={C.primary} />
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {!showSearch && (
          <View ref={balanceCardRef} onLayout={measureBalanceCard}>
            <TotalBalanceDisplay balances={totalBalances} />
          </View>
        )}
      </View>

      {/* Main Content */}
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refetch}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>{t('groups.title')}</Text>
        </View>

        {/* Status filter pills */}
        <View style={s.filterPillRow}>
          {statusFilters.map(({ key, label }) => (
            <Pressable
              key={key}
              style={[s.filterPill, statusFilter === key && s.filterPillActive]}
              onPress={() => setStatusFilter(key)}
            >
              <Text
                style={[
                  s.filterPillText,
                  statusFilter === key && s.filterPillTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {error ? (
          <View style={s.centered}>
            <MaterialIcons name="error-outline" size={40} color={C.danger} />
            <Text style={s.errorText}>{error}</Text>
            <Pressable style={s.retryBtn} onPress={refetch}>
              <Text style={s.retryText}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : loading && groups.length === 0 ? (
          <View style={s.centered}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : (
          <>
            {visibleGroups.length === 0 && groups.length > 0 && (
              <View style={s.centered}>
                <MaterialIcons
                  name="search-off"
                  size={40}
                  color={C.surfaceHL}
                />
                <Text style={s.errorText}>{t('groups.noMatch')}</Text>
              </View>
            )}
            {visibleGroups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}

            {/* Archived groups section */}
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [
                s.archivedHeader,
                pressed && { opacity: 0.7 },
              ]}
              onPress={handleArchivedToggle}
            >
              <View style={s.archivedHeaderLeft}>
                <MaterialIcons name="archive" size={16} color={C.slate400} />
                <Text style={s.archivedHeaderText}>{t('groups.archived')}</Text>
              </View>
              <MaterialIcons
                name={archivedExpanded ? 'expand-less' : 'expand-more'}
                size={20}
                color={C.slate400}
              />
            </Pressable>

            {archivedExpanded &&
              (archivedLoading ? (
                <ActivityIndicator
                  color={C.primary}
                  style={{ marginVertical: 16 }}
                />
              ) : archivedGroups.length === 0 ? (
                <Text style={s.archivedEmpty}>{t('groups.noArchivedGroups')}</Text>
              ) : (
                archivedGroups.map((group) => (
                  <GroupCard key={group.id} group={group} />
                ))
              ))}

            <View style={s.newGroupRow}>
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [
                  s.newGroupBtn,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => router.push('/create-group')}
              >
                <MaterialIcons name="group-add" size={20} color={C.primary} />
                <Text style={s.newGroupText}>{t('groups.startNew')}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <View
        ref={fabRef}
        onLayout={measureFab}
        style={[s.fabWrapper, { bottom: insets.bottom + 72 }]}
      >
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.fab,
            pressed && { opacity: 0.85 },
          ]}
          onPress={() =>
            groups.length === 0
              ? router.push('/create-group')
              : router.push('/add-expense')
          }
          testID="fab-add-expense"
        >
          <MaterialIcons name="add" size={32} color={C.bg} />
        </Pressable>
      </View>

      {/* Onboarding tooltip overlay */}
      <OnboardingTooltip {...tooltipProps} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
    paddingHorizontal: 16,
    paddingBottom: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: C.primary, fontWeight: '700', fontSize: 16 },
  appTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceCard: {
    backgroundColor: C.surfaceHL,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  balanceCardBg: { position: 'absolute', top: 8, right: 8, opacity: 0.1 },
  balanceLabel: {
    color: C.slate300,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  balanceAmount: {
    color: C.primary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  currencyChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  currencyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(23, 232, 107, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  currencyChipDebt: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  currencyChipAmount: {
    color: C.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  currencyChipCode: {
    color: C.primary,
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.7,
  },
  balanceTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  balanceTrendText: {
    color: C.primary,
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.8,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: C.slate400,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: C.surfaceHL,
    borderRadius: 12,
    paddingHorizontal: 10,
    height: 44,
  },
  searchInput: { flex: 1, color: C.white, fontSize: 15 },
  filterPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    flexWrap: 'nowrap',
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  filterPillActive: { backgroundColor: C.surfaceHL, borderColor: C.primary },
  filterPillText: { color: C.slate400, fontSize: 12, fontWeight: '600' },
  filterPillTextActive: { color: C.white },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  groupIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: C.surfaceHL,
  },
  groupImage: { width: '100%', height: '100%' },
  groupInfo: { flex: 1, minWidth: 0 },
  groupName: { color: C.white, fontWeight: '700', fontSize: 15 },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  memberStack: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.surface,
  },
  memberAvatarInitials: {
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitialsText: {
    color: C.primary,
    fontSize: 8,
    fontWeight: '700',
  },
  groupSubtitle: { fontSize: 12, color: C.slate400, flexShrink: 1 },
  groupAmount: { alignItems: 'flex-end', flexShrink: 0 },
  amountLabel: { fontSize: 12, fontWeight: '700' },
  amountValue: { fontSize: 17, fontWeight: '700' },
  settledText: { fontSize: 13, fontWeight: '500', color: C.slate400 },
  andMoreText: { fontSize: 11, color: C.slate400, fontWeight: '600' },
  centered: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  errorText: { color: C.slate400, fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: C.surfaceHL,
    borderRadius: 999,
  },
  retryText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
    marginTop: 8,
  },
  archivedHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  archivedHeaderText: {
    color: C.slate400,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  archivedEmpty: {
    color: C.slate500,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
  newGroupRow: { alignItems: 'center', paddingVertical: 8 },
  newGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  newGroupText: { color: C.slate400, fontSize: 14, fontWeight: '500' },
  fabWrapper: {
    position: 'absolute',
    right: 16,
    width: 56,
    height: 56,
  },
  fab: {
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
});
