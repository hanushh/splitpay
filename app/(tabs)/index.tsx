import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { APP_DISPLAY_NAME } from '@/lib/app-config';
import { Group, useGroups } from '@/hooks/use-groups';

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
  const { format } = useCurrency();
  const amountColor = group.status === 'owes' ? C.orange : C.primary;
  const opacity = group.archived ? 0.7 : 1;

  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => [s.groupCard, { opacity: pressed ? 0.85 : opacity }]}
      onPress={() => router.push({ pathname: '/group/[id]', params: { id: group.id } })}
      testID={`group-card-${group.id}`}
    >
      <View style={[s.groupIcon, { backgroundColor: group.bg_color }]}>
        {group.image_url ? (
          <Image source={{ uri: group.image_url }} style={s.groupImage} />
        ) : (
          <MaterialIcons
            name={(group.icon_name as keyof typeof MaterialIcons.glyphMap) ?? 'group'}
            size={28}
            color={C.primary}
          />
        )}
      </View>

      <View style={s.groupInfo}>
        <Text style={s.groupName} numberOfLines={1}>{group.name}</Text>
        <View style={s.groupMeta}>
          {group.members.length > 0 && (
            <View style={s.memberStack}>
              {group.members.slice(0, 3).map((m, i) => (
                <Image
                  key={m.id}
                  source={{ uri: m.avatar_url! }}
                  style={[s.memberAvatar, { marginLeft: i === 0 ? 0 : -8 }]}
                />
              ))}
            </View>
          )}
          {group.description ? (
            <Text style={s.groupSubtitle} numberOfLines={1}>{group.description}</Text>
          ) : null}
        </View>
      </View>

      <View style={s.groupAmount}>
        {group.status === 'settled' ? (
          <Text style={s.settledText}>settled up</Text>
        ) : (
          <>
            <Text style={[s.amountLabel, { color: amountColor }]}>
              {group.status === 'owed' ? 'you are owed' : 'you owe'}
            </Text>
            <Text style={[s.amountValue, { color: amountColor }]}>{format(group.balance_cents)}</Text>
          </>
        )}
      </View>

      <MaterialIcons name="chevron-right" size={22} color={C.surfaceHL} />
    </Pressable>
  );
}

function TotalBalanceDisplay({ cents }: { cents: number }) {
  const { format } = useCurrency();
  const isPositive = cents >= 0;
  const label = cents === 0
    ? 'You are all settled up'
    : isPositive
    ? `You are owed ${format(cents)}`
    : `You owe ${format(cents)}`;

  return (
    <View style={s.balanceCard}>
      <View style={s.balanceCardBg}>
        <MaterialIcons name="account-balance-wallet" size={64} color={C.white} />
      </View>
      <Text style={s.balanceLabel}>Total Balance</Text>
      <Text style={[s.balanceAmount, !isPositive && { color: C.orange }]}>{label}</Text>
      <View style={s.balanceTrend}>
        <MaterialIcons
          name={isPositive ? 'trending-up' : 'trending-down'}
          size={14}
          color={isPositive ? C.primary : C.orange}
        />
        <Text style={[s.balanceTrendText, !isPositive && { color: C.orange }]}>
          across {cents !== 0 ? 'active' : 'all'} groups
        </Text>
      </View>
    </View>
  );
}

export default function GroupsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'friends' | 'groups'>('groups');
  const { groups, loading, error, refetch, totalBalanceCents } = useGroups();

  const avatarLetter = user?.email?.[0]?.toUpperCase() ?? 'U';

  return (
    <View style={[s.container, { paddingTop: insets.top }]} testID="groups-screen">
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={s.headerLeft}>
            <View style={s.avatar}>
              <Text style={s.avatarLetter}>{avatarLetter}</Text>
            </View>
            <Text style={s.appTitle}>{APP_DISPLAY_NAME}</Text>
          </View>
          <View style={s.headerIcons}>
            <Pressable style={s.iconBtn} hitSlop={8}>
              <MaterialIcons name="search" size={24} color={C.slate400} />
            </Pressable>
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

        <TotalBalanceDisplay cents={totalBalanceCents} />

        {/* Header Tabs */}
        <View style={s.headerTabs}>
          <Pressable
            style={[s.headerTab, activeTab === 'friends' && s.headerTabActive]}
            onPress={() => setActiveTab('friends')}
          >
            <Text style={[s.headerTabText, activeTab === 'friends' && s.headerTabTextActive]}>
              Friends
            </Text>
          </Pressable>
          <Pressable
            style={[s.headerTab, activeTab === 'groups' && s.headerTabActive]}
            onPress={() => setActiveTab('groups')}
            testID="groups-tab"
          >
            <Text style={[s.headerTabText, activeTab === 'groups' && s.headerTabTextActive]} testID="groups-tab-label">
              Groups
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView
        style={s.scrollView}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 80 }]}
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
          <Text style={s.sectionTitle}>Your Groups</Text>
          <Pressable style={s.filterBtn} hitSlop={8}>
            <MaterialIcons name="filter-list" size={16} color={C.primary} />
            <Text style={s.filterText}>Filter</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={s.centered}>
            <MaterialIcons name="error-outline" size={40} color={C.danger} />
            <Text style={s.errorText}>{error}</Text>
            <Pressable style={s.retryBtn} onPress={refetch}>
              <Text style={s.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : loading && groups.length === 0 ? (
          <View style={s.centered}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : (
          <>
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}

            <View style={s.newGroupRow}>
              <Pressable
                style={({ pressed }: { pressed: boolean }) => [s.newGroupBtn, pressed && { opacity: 0.7 }]}
                onPress={() => router.push('/create-group')}
              >
                <MaterialIcons name="group-add" size={20} color={C.primary} />
                <Text style={s.newGroupText}>Start a new group</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [s.fab, { bottom: insets.bottom + 72 }, pressed && { opacity: 0.85 }]}
        onPress={() => router.push('/add-expense')}
        testID="fab-add-expense"
      >
        <MaterialIcons name="add" size={32} color={C.bg} />
      </Pressable>
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surfaceHL,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: C.primary, fontWeight: '700', fontSize: 16 },
  appTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  balanceCard: {
    backgroundColor: C.surfaceHL,
    borderRadius: 12, padding: 20,
    marginBottom: 20, overflow: 'hidden', position: 'relative',
  },
  balanceCardBg: { position: 'absolute', top: 8, right: 8, opacity: 0.1 },
  balanceLabel: { color: C.slate300, fontSize: 13, fontWeight: '500', marginBottom: 4 },
  balanceAmount: { color: C.primary, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  balanceTrend: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 4 },
  balanceTrendText: { color: C.primary, fontSize: 13, fontWeight: '500', opacity: 0.8 },
  headerTabs: { flexDirection: 'row' },
  headerTab: {
    flex: 1, paddingBottom: 12,
    alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  headerTabActive: { borderBottomColor: C.primary },
  headerTabText: { fontSize: 14, fontWeight: '500', color: C.slate400 },
  headerTabTextActive: { color: C.primary, fontWeight: '700' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '600', color: C.slate400,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filterText: { color: C.primary, fontSize: 13, fontWeight: '500' },
  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, padding: 16,
    borderRadius: 12, borderWidth: 1, borderColor: C.surfaceHL,
  },
  groupIcon: {
    width: 56, height: 56, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', flexShrink: 0,
  },
  groupImage: { width: '100%', height: '100%' },
  groupInfo: { flex: 1, minWidth: 0 },
  groupName: { color: C.white, fontWeight: '700', fontSize: 15 },
  groupMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  memberStack: { flexDirection: 'row', alignItems: 'center' },
  memberAvatar: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.surface,
  },
  groupSubtitle: { fontSize: 12, color: C.slate400, flexShrink: 1 },
  groupAmount: { alignItems: 'flex-end', flexShrink: 0 },
  amountLabel: { fontSize: 12, fontWeight: '700' },
  amountValue: { fontSize: 17, fontWeight: '700' },
  settledText: { fontSize: 13, fontWeight: '500', color: C.slate400 },
  centered: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  errorText: { color: C.slate400, fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 10, paddingHorizontal: 24,
    backgroundColor: C.surfaceHL, borderRadius: 999,
  },
  retryText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  newGroupRow: { alignItems: 'center', paddingVertical: 8 },
  newGroupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999,
  },
  newGroupText: { color: C.slate400, fontSize: 14, fontWeight: '500' },
  fab: {
    position: 'absolute', right: 16,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
});
