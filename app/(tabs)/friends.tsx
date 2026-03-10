import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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

import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { APP_DISPLAY_NAME } from '@/lib/app-config';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  danger: '#ff5252',
  orange: '#f97316',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

interface Friend {
  id: string;
  display_name: string;
  avatar_url: string | null;
  balance_cents: number;
}

function FriendCard({ friend }: { friend: Friend }) {
  const { format } = useCurrency();
  const isOwed = friend.balance_cents > 0;
  const isOwes = friend.balance_cents < 0;
  const amount = format(friend.balance_cents);
  const initials = friend.display_name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Pressable style={({ pressed }: { pressed: boolean }) => [s.card, pressed && { opacity: 0.8 }]}>
      <View style={s.avatarWrap}>
        {friend.avatar_url ? (
          <Image source={{ uri: friend.avatar_url }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, s.avatarFallback]}>
            <Text style={s.avatarInitials}>{initials}</Text>
          </View>
        )}
        <View style={[s.statusDot, { backgroundColor: isOwed ? C.primary : isOwes ? C.orange : C.slate400 }]} />
      </View>

      <View style={s.info}>
        <Text style={s.name}>{friend.display_name}</Text>
        <Text style={s.meta}>
          {isOwed ? 'owes you' : isOwes ? 'you owe' : 'settled up'}
        </Text>
      </View>

      <View style={s.right}>
        {friend.balance_cents === 0 ? (
          <Text style={s.settled}>settled up</Text>
        ) : (
          <>
            <Text style={[s.amountLabel, { color: isOwed ? C.primary : C.orange }]}>
              {isOwed ? 'you are owed' : 'you owe'}
            </Text>
            <Text style={[s.amount, { color: isOwed ? C.primary : C.orange }]}>{amount}</Text>
          </>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={20} color={C.slate400} />
    </Pressable>
  );
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchFriends = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('get_friend_balances', { p_user_id: user.id });
    if (error) { setLoading(false); setRefreshing(false); return; }

    const friendList: Friend[] = ((data as { display_name: string; avatar_url: string | null; balance_cents: number }[]) ?? [])
      .map((row, i) => ({
        id: String(i),
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        balance_cents: Number(row.balance_cents),
      }));

    setFriends(friendList);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { fetchFriends(); }, [fetchFriends]);

  const onRefresh = () => { setRefreshing(true); fetchFriends(); };

  const filtered = friends.filter((f) =>
    f.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOwed = friends.filter((f) => f.balance_cents > 0).reduce((s, f) => s + f.balance_cents, 0);
  const totalOwes = friends.filter((f) => f.balance_cents < 0).reduce((s, f) => s + Math.abs(f.balance_cents), 0);
  const netCents = totalOwed - totalOwes;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.logoCircle}><Text style={s.logoText}>S</Text></View>
          <Text style={s.headerTitle}>{APP_DISPLAY_NAME}</Text>
        </View>
        <Pressable style={s.headerIcon}>
          <MaterialIcons name="search" size={24} color={C.white} />
        </Pressable>
      </View>

      {/* Balance card */}
      <View style={s.balanceCard}>
        <Text style={s.balanceLabel}>Total Balance</Text>
        {netCents === 0 ? (
          <Text style={s.balanceAmount}>You are all settled up</Text>
        ) : (
          <Text style={[s.balanceAmount, { color: netCents > 0 ? C.primary : C.orange }]}>
            {netCents > 0 ? `You are owed ${format(netCents)}` : `You owe ${format(netCents)}`}
          </Text>
        )}
        <View style={s.balanceMeta}>
          <MaterialIcons name="trending-up" size={14} color={C.primary} />
          <Text style={s.balanceMetaText}>across all friends</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        <Pressable style={s.tab}><Text style={s.tabInactive}>Groups</Text></Pressable>
        <Pressable style={[s.tab, s.tabActive]}><Text style={s.tabActiveText}>Friends</Text></Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Search */}
        <View style={s.searchRow}>
          <View style={s.searchBar}>
            <MaterialIcons name="search" size={18} color={C.slate400} />
            <TextInput
              style={s.searchInput}
              placeholder="Search friends…"
              placeholderTextColor={C.slate400}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <Pressable style={s.addBtn} onPress={() => router.push('/invite-friend')}>
            <MaterialIcons name="person-add" size={18} color={C.primary} />
          </Pressable>
        </View>

        {/* Section header */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>YOUR FRIENDS</Text>
          <Pressable style={s.filterBtn}>
            <MaterialIcons name="filter-list" size={16} color={C.slate400} />
            <Text style={s.filterText}>Filter</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <MaterialIcons name="person-add" size={48} color={C.surfaceHL} />
            <Text style={s.emptyTitle}>{search ? 'No matches' : 'No friends yet'}</Text>
            <Text style={s.emptySubtitle}>{search ? 'Try a different name' : 'Add a friend to start splitting expenses'}</Text>
          </View>
        ) : (
          filtered.map((f) => <FriendCard key={f.id} friend={f} />)
        )}

        {/* Add friend CTA */}
        {!loading && !search && (
          <Pressable style={s.addFriendRow} onPress={() => router.push('/invite-friend')}>
            <MaterialIcons name="person-add" size={22} color={C.primary} />
            <Text style={s.addFriendText}>Invite a friend</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* FAB */}
      <Pressable style={({ pressed }: { pressed: boolean }) => [s.fab, pressed && { opacity: 0.85 }]}>
        <MaterialIcons name="add" size={28} color={C.bg} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoCircle: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: C.bg, fontWeight: '800', fontSize: 16 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  headerIcon: { padding: 4 },
  balanceCard: { marginHorizontal: 16, marginBottom: 4, backgroundColor: C.surface, borderRadius: 16, padding: 20, gap: 4 },
  balanceLabel: { color: C.slate400, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  balanceAmount: { color: C.primary, fontSize: 22, fontWeight: '700' },
  balanceMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  balanceMetaText: { color: C.primary, fontSize: 12 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginVertical: 8, backgroundColor: C.surface, borderRadius: 12, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabActive: { backgroundColor: C.surfaceHL },
  tabInactive: { color: C.slate400, fontWeight: '600', fontSize: 14 },
  tabActiveText: { color: C.white, fontWeight: '700', fontSize: 14 },
  scrollContent: { paddingBottom: 100 },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, marginBottom: 16, marginTop: 4 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: C.surfaceHL },
  searchInput: { flex: 1, color: C.white, fontSize: 14 },
  addBtn: { width: 44, height: 44, backgroundColor: C.surface, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.surfaceHL },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  sectionTitle: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  filterText: { color: C.slate400, fontSize: 12, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, backgroundColor: C.surface, borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: '#244732' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: C.primary, fontWeight: '700', fontSize: 16 },
  statusDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: C.bg },
  info: { flex: 1 },
  name: { color: C.white, fontWeight: '700', fontSize: 15, marginBottom: 2 },
  meta: { color: C.slate400, fontSize: 12 },
  right: { alignItems: 'flex-end' },
  amountLabel: { fontSize: 11, fontWeight: '600' },
  amount: { fontSize: 17, fontWeight: '700' },
  settled: { color: C.slate400, fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: C.slate400, fontSize: 14, textAlign: 'center' },
  addFriendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, marginTop: 8 },
  addFriendText: { color: C.primary, fontWeight: '600', fontSize: 14 },
  fab: { position: 'absolute', bottom: 24, right: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
});
