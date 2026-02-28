import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  white: '#ffffff',
};

interface MemberBalance {
  id: string;
  display_name: string;
  avatar_url: string | null;
  balance_cents: number;
  isCurrentUser: boolean;
}

export default function GroupBalancesScreen() {
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string; groupName: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [members, setMembers] = useState<MemberBalance[]>([]);
  const [totalCents, setTotalCents] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchBalances = useCallback(async () => {
    if (!user || !groupId) return;

    const [{ data: myBalance }, { data: memberRows }] = await Promise.all([
      supabase.from('group_balances').select('balance_cents').eq('group_id', groupId).eq('user_id', user.id).single(),
      supabase.rpc('get_group_member_balances', { p_group_id: groupId, p_user_id: user.id }),
    ]);

    setTotalCents(myBalance?.balance_cents ?? 0);

    const list: MemberBalance[] = ((memberRows as { member_id: string; display_name: string; avatar_url: string | null; balance_cents: number }[]) ?? [])
      .map((row) => ({
        id: row.member_id,
        display_name: row.display_name ?? 'Unknown',
        avatar_url: row.avatar_url,
        balance_cents: Number(row.balance_cents),
        isCurrentUser: false,
      }));

    setMembers(list);
    setLoading(false);
  }, [user, groupId]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  const totalText = totalCents === 0
    ? 'All settled up'
    : totalCents > 0
      ? `+${format(totalCents)}`
      : `-${format(totalCents)}`;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>{groupName ?? 'Group'}</Text>
        <Pressable style={s.backBtn}>
          <MaterialIcons name="settings" size={24} color={C.white} />
        </Pressable>
      </View>

      {/* Total balance banner */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <Text style={[s.bannerAmount, { color: totalCents >= 0 ? C.primary : C.orange }]}>
            {totalText}
          </Text>
          <Text style={s.bannerSub}>
            {totalCents > 0 ? 'You are owed in total' : totalCents < 0 ? 'You owe in total' : 'You are all settled up'}
          </Text>
        </View>
        <Pressable style={s.chartBtn}>
          <MaterialIcons name="bar-chart" size={22} color={C.primary} />
          <Text style={s.chartBtnText}>View chart</Text>
        </Pressable>
      </View>

      <Text style={s.sectionTitle}>GROUP MEMBERS</Text>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.listContent}>
          {members.map((m) => {
            const initials = m.display_name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
            const isOwed = m.balance_cents > 0;
            const isOwes = m.balance_cents < 0;
            const amtText = format(m.balance_cents);

            return (
              <View key={m.id} style={s.memberCard}>
                <View style={s.memberLeft}>
                  {m.avatar_url ? (
                    <Image source={{ uri: m.avatar_url }} style={s.memberAvatar} />
                  ) : (
                    <View style={[s.memberAvatar, m.isCurrentUser ? s.meAvatar : s.defaultAvatar]}>
                      <Text style={[s.memberInitials, m.isCurrentUser && { color: C.bg }]}>{initials}</Text>
                    </View>
                  )}
                  <View>
                    <Text style={[s.memberName, m.isCurrentUser && { color: C.primary }]}>
                      {m.isCurrentUser ? 'ME' : m.display_name}
                    </Text>
                    {m.isCurrentUser && <Text style={s.memberSub}>You</Text>}
                  </View>
                </View>

                <View style={s.memberRight}>
                  {m.balance_cents === 0 ? (
                    <Text style={s.settledText}>Settled up</Text>
                  ) : (
                    <View style={s.balanceInfo}>
                      <Text style={[s.balanceText, { color: isOwed ? C.primary : C.orange }]}>
                        {isOwed ? `owes you ${amtText}` : `you owe ${amtText}`}
                      </Text>
                      {!m.isCurrentUser && (
                        <Pressable
                          style={s.settleBtn}
                          onPress={() => router.push({ pathname: '/settle-up', params: { groupId, groupName, friendName: m.display_name } })}
                        >
                          <Text style={s.settleBtnText}>{isOwed ? 'Settle up' : 'Pay'}</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8 },
  backBtn: { padding: 10 },
  headerTitle: { flex: 1, color: C.white, fontWeight: '700', fontSize: 18, textAlign: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 20, backgroundColor: C.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: C.surfaceHL },
  bannerLeft: { gap: 4 },
  bannerAmount: { fontSize: 28, fontWeight: '700' },
  bannerSub: { color: C.slate400, fontSize: 13 },
  chartBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surfaceHL, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  chartBtnText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginBottom: 10 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  memberCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.surfaceHL },
  memberLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberAvatar: { width: 48, height: 48, borderRadius: 24 },
  meAvatar: { backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  defaultAvatar: { backgroundColor: C.surfaceHL, alignItems: 'center', justifyContent: 'center' },
  memberInitials: { color: C.primary, fontWeight: '700', fontSize: 16 },
  memberName: { color: C.white, fontWeight: '700', fontSize: 15 },
  memberSub: { color: C.slate400, fontSize: 12 },
  memberRight: { alignItems: 'flex-end' },
  settledText: { color: C.slate400, fontWeight: '600', fontSize: 13 },
  balanceInfo: { alignItems: 'flex-end', gap: 6 },
  balanceText: { fontWeight: '600', fontSize: 14 },
  settleBtn: { backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  settleBtnText: { color: C.bg, fontWeight: '700', fontSize: 13 },
});
