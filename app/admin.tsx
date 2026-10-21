import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

import {
  useAdminCheck,
  useAdminData,
  type AdminUser,
  type AdminActivityItem,
} from '@/hooks/use-admin';

const C = {
  primary: '#17e86b',
  primaryDim: 'rgba(23,232,107,0.15)',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  orange: '#f97316',
  danger: '#ff5252',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  white: '#ffffff',
  overlay: 'rgba(0,0,0,0.5)',
};

type Tab = 'users' | 'activity';

function formatAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatLargeAmount(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  accent?: string;
}) {
  const color = accent ?? C.primary;
  return (
    <View style={[s.statCard, { borderColor: color + '33' }]}>
      <View style={[s.statIconWrap, { backgroundColor: color + '22' }]}>
        <MaterialIcons name={icon} size={18} color={color} />
      </View>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function UserRow({ item }: { item: AdminUser }) {
  const { t } = useTranslation();
  const initial = (item.name ?? item.email)[0]?.toUpperCase() ?? '?';
  return (
    <View style={s.userRow}>
      <View style={s.userAvatar}>
        <Text style={s.userAvatarText}>{initial}</Text>
      </View>
      <View style={s.userInfo}>
        <View style={s.userNameRow}>
          <Text style={s.userName} numberOfLines={1}>
            {item.name ?? item.email.split('@')[0]}
          </Text>
          {item.is_admin && (
            <View style={s.adminBadge}>
              <Text style={s.adminBadgeText}>admin</Text>
            </View>
          )}
        </View>
        <Text style={s.userEmail} numberOfLines={1}>{item.email}</Text>
        <Text style={s.userMeta}>
          {t('admin.userGroups', { count: item.group_count })}
          {'  ·  '}
          {t('admin.userJoined', { date: formatDate(item.created_at) })}
        </Text>
      </View>
      <View style={s.userStats}>
        <MaterialIcons name="receipt-long" size={12} color={C.slate500} />
        <Text style={s.userExpenseCount}>{item.expense_count}</Text>
      </View>
    </View>
  );
}

function ActivityRow({ item }: { item: AdminActivityItem }) {
  const { t } = useTranslation();
  return (
    <View style={s.activityRow}>
      <View style={s.activityIconWrap}>
        <MaterialIcons name="receipt" size={16} color={C.primary} />
      </View>
      <View style={s.activityInfo}>
        <Text style={s.activityDesc} numberOfLines={1}>{item.description}</Text>
        <Text style={s.activityMeta} numberOfLines={1}>
          {item.user_name}
          {'  ·  '}
          {t('admin.inGroup', { group: item.group_name })}
        </Text>
      </View>
      <View style={s.activityRight}>
        <Text style={s.activityAmount}>{formatAmount(item.amount_cents)}</Text>
        <Text style={s.activityTime}>{formatRelative(item.created_at)}</Text>
      </View>
    </View>
  );
}

function AccessDeniedView() {
  const { t } = useTranslation();
  return (
    <View style={s.centered}>
      <MaterialIcons name="block" size={48} color={C.danger} />
      <Text style={s.accessDeniedTitle}>{t('admin.accessDenied')}</Text>
      <Text style={s.accessDeniedSub}>{t('admin.accessDeniedSub')}</Text>
      <Pressable style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backBtnText}>{t('common.cancel')}</Text>
      </Pressable>
    </View>
  );
}

export default function AdminScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAdmin, loading: checkLoading } = useAdminCheck();
  const { stats, users, activity, loading, error, refetch } = useAdminData();
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [search, setSearch] = useState('');

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone?.includes(q),
    );
  }, [users, search]);

  if (checkLoading) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={[s.container, { paddingTop: insets.top }]}>
        <AccessDeniedView />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.backPress, pressed && { opacity: 0.6 }]}
          onPress={() => router.back()}
        >
          <MaterialIcons name="arrow-back" size={22} color={C.white} />
        </Pressable>
        <View style={s.headerCenter}>
          <MaterialIcons name="admin-panel-settings" size={20} color={C.primary} />
          <Text style={s.headerTitle}>{t('admin.title')}</Text>
        </View>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [s.refreshPress, pressed && { opacity: 0.6 }]}
          onPress={refetch}
        >
          <MaterialIcons name="refresh" size={22} color={C.slate400} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refetch}
            tintColor={C.primary}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* Error banner */}
        {error ? (
          <View style={s.errorBanner}>
            <MaterialIcons name="error-outline" size={16} color={C.danger} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Stats grid */}
        {loading && !stats ? (
          <View style={s.statsLoading}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : stats ? (
          <View style={s.statsGrid}>
            <StatCard
              label={t('admin.statsUsers')}
              value={stats.total_users.toLocaleString()}
              icon="people"
            />
            <StatCard
              label={t('admin.statsNewToday')}
              value={stats.new_users_today.toLocaleString()}
              icon="person-add"
              accent={C.orange}
            />
            <StatCard
              label={t('admin.statsGroups')}
              value={`${stats.active_groups.toLocaleString()} / ${stats.total_groups.toLocaleString()}`}
              icon="group-work"
              accent="#a78bfa"
            />
            <StatCard
              label={t('admin.statsExpenses')}
              value={stats.total_expenses.toLocaleString()}
              icon="receipt-long"
              accent={C.primary}
            />
            <StatCard
              label={t('admin.totalSpend')}
              value={formatLargeAmount(stats.total_expense_amount_cents)}
              icon="payments"
              accent={C.orange}
            />
          </View>
        ) : null}

        {/* Tab selector */}
        <View style={s.tabs}>
          <Pressable
            style={[s.tab, activeTab === 'users' && s.tabActive]}
            onPress={() => setActiveTab('users')}
          >
            <MaterialIcons
              name="people"
              size={16}
              color={activeTab === 'users' ? C.primary : C.slate400}
            />
            <Text style={[s.tabText, activeTab === 'users' && s.tabTextActive]}>
              {t('admin.tabUsers')} ({users.length})
            </Text>
          </Pressable>
          <Pressable
            style={[s.tab, activeTab === 'activity' && s.tabActive]}
            onPress={() => setActiveTab('activity')}
          >
            <MaterialIcons
              name="bolt"
              size={16}
              color={activeTab === 'activity' ? C.primary : C.slate400}
            />
            <Text
              style={[s.tabText, activeTab === 'activity' && s.tabTextActive]}
            >
              {t('admin.tabActivity')}
            </Text>
          </Pressable>
        </View>

        {/* Users tab */}
        {activeTab === 'users' && (
          <View style={s.tabContent}>
            <View style={s.searchWrap}>
              <MaterialIcons name="search" size={18} color={C.slate500} style={s.searchIcon} />
              <TextInput
                style={s.searchInput}
                placeholder={t('admin.searchPlaceholder')}
                placeholderTextColor={C.slate500}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')}>
                  <MaterialIcons name="close" size={16} color={C.slate500} />
                </Pressable>
              )}
            </View>

            {loading ? (
              <View style={s.listLoading}>
                <ActivityIndicator color={C.primary} />
              </View>
            ) : filteredUsers.length === 0 ? (
              <View style={s.emptyWrap}>
                <MaterialIcons name="person-search" size={36} color={C.slate600} />
                <Text style={s.emptyText}>{t('admin.noUsers')}</Text>
              </View>
            ) : (
              <View style={s.listCard}>
                <FlatList<AdminUser>
                  data={filteredUsers}
                  keyExtractor={(item: AdminUser) => item.id}
                  renderItem={({ item, index }: { item: AdminUser; index: number }) => (
                    <>
                      <UserRow item={item} />
                      {index < filteredUsers.length - 1 && (
                        <View style={s.separator} />
                      )}
                    </>
                  )}
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        )}

        {/* Activity tab */}
        {activeTab === 'activity' && (
          <View style={s.tabContent}>
            {loading ? (
              <View style={s.listLoading}>
                <ActivityIndicator color={C.primary} />
              </View>
            ) : activity.length === 0 ? (
              <View style={s.emptyWrap}>
                <MaterialIcons name="history" size={36} color={C.slate600} />
                <Text style={s.emptyText}>{t('admin.noActivity')}</Text>
              </View>
            ) : (
              <View style={s.listCard}>
                <FlatList<AdminActivityItem>
                  data={activity}
                  keyExtractor={(item: AdminActivityItem) => item.id}
                  renderItem={({ item, index }: { item: AdminActivityItem; index: number }) => (
                    <>
                      <ActivityRow item={item} />
                      {index < activity.length - 1 && (
                        <View style={s.separator} />
                      )}
                    </>
                  )}
                  scrollEnabled={false}
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  backPress: {
    padding: 4,
  },
  refreshPress: {
    padding: 4,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: C.white,
    fontSize: 17,
    fontWeight: '700',
  },
  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,82,82,0.12)',
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  errorText: {
    color: C.danger,
    fontSize: 13,
    flex: 1,
  },
  // Stats
  statsLoading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statValue: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  // Tabs
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: C.surfaceHL,
  },
  tabText: {
    color: C.slate400,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: C.primary,
  },
  // Tab content
  tabContent: {
    marginTop: 12,
  },
  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    color: C.white,
    fontSize: 14,
    padding: 0,
  },
  // List
  listLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  listCard: {
    marginHorizontal: 16,
    backgroundColor: C.surface,
    borderRadius: 14,
    overflow: 'hidden',
  },
  separator: {
    height: 1,
    backgroundColor: C.surfaceHL,
    marginHorizontal: 16,
  },
  // User row
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.primary + '55',
  },
  userAvatarText: {
    color: C.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
    gap: 2,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    color: C.white,
    fontSize: 14,
    fontWeight: '600',
  },
  adminBadge: {
    backgroundColor: C.primaryDim,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  adminBadgeText: {
    color: C.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  userEmail: {
    color: C.slate400,
    fontSize: 12,
  },
  userMeta: {
    color: C.slate600,
    fontSize: 11,
    marginTop: 1,
  },
  userStats: {
    alignItems: 'center',
    gap: 2,
  },
  userExpenseCount: {
    color: C.slate500,
    fontSize: 11,
    fontWeight: '600',
  },
  // Activity row
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  activityIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityInfo: {
    flex: 1,
    gap: 3,
  },
  activityDesc: {
    color: C.white,
    fontSize: 14,
    fontWeight: '500',
  },
  activityMeta: {
    color: C.slate500,
    fontSize: 12,
  },
  activityRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  activityAmount: {
    color: C.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  activityTime: {
    color: C.slate600,
    fontSize: 11,
  },
  // Empty
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    color: C.slate500,
    fontSize: 14,
  },
  // Access denied
  accessDeniedTitle: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  accessDeniedSub: {
    color: C.slate400,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  backBtn: {
    marginTop: 24,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  backBtnText: {
    color: C.white,
    fontSize: 15,
    fontWeight: '600',
  },
});
