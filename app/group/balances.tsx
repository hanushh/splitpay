import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { settlementEvents } from '@/lib/settlement-events';
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
  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName: string;
  }>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [members, setMembers] = useState<MemberBalance[]>([]);
  const [totalCents, setTotalCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!user || !groupId) return;
    setFetchError(null);

    const [
      { data: myBalance, error: balanceErr },
      { data: memberRows, error: membersErr },
      { data: myMember, error: myMemberErr },
    ] = await Promise.all([
      supabase
        .from('group_balances')
        .select('balance_cents')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .single(),
      supabase.rpc('get_group_member_balances', {
        p_group_id: groupId,
        p_user_id: user.id,
      }),
      supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .single(),
    ]);

    if (membersErr) {
      setFetchError(membersErr.message ?? 'Failed to load member balances.');
      setLoading(false);
      return;
    }
    if (balanceErr && balanceErr.code !== 'PGRST116') {
      // PGRST116 = row not found (no balance row yet) — treat as 0, not an error
      setFetchError(balanceErr.message ?? 'Failed to load your balance.');
      setLoading(false);
      return;
    }
    if (myMemberErr && myMemberErr.code !== 'PGRST116') {
      setFetchError(
        myMemberErr.message ?? 'Failed to identify your membership.',
      );
      setLoading(false);
      return;
    }

    setTotalCents(myBalance?.balance_cents ?? 0);
    setMyMemberId((myMember as { id: string } | null)?.id ?? null);

    const list: MemberBalance[] = (
      (memberRows as {
        member_id: string;
        display_name: string;
        avatar_url: string | null;
        balance_cents: number;
      }[]) ?? []
    ).map((row) => ({
      id: row.member_id,
      display_name: row.display_name ?? 'Unknown',
      avatar_url: row.avatar_url,
      balance_cents: Number(row.balance_cents),
      isCurrentUser: false,
    }));

    setMembers(list);
    setLoading(false);
  }, [user, groupId]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);
  useFocusEffect(
    useCallback(() => {
      fetchBalances();
    }, [fetchBalances]),
  );
  useEffect(
    () =>
      settlementEvents.subscribe(() => {
        fetchBalances();
      }),
    [fetchBalances],
  );

  const totalText =
    totalCents === 0
      ? t('balances.allSettled')
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
        <Text style={s.headerTitle} numberOfLines={1}>
          {groupName ?? 'Group'}
        </Text>
        <Pressable style={s.backBtn}>
          <MaterialIcons name="settings" size={24} color={C.white} />
        </Pressable>
      </View>

      {/* Total balance banner */}
      <View style={s.banner}>
        <View style={s.bannerLeft}>
          <Text
            style={[
              s.bannerAmount,
              { color: totalCents >= 0 ? C.primary : C.orange },
            ]}
          >
            {totalText}
          </Text>
          <Text style={s.bannerSub}>
            {totalCents > 0
              ? t('balances.youAreOwedTotal')
              : totalCents < 0
                ? t('balances.youOweTotal')
                : t('balances.allSettledTotal')}
          </Text>
        </View>
        <Pressable style={s.chartBtn}>
          <MaterialIcons name="bar-chart" size={22} color={C.primary} />
          <Text style={s.chartBtnText}>{t('balances.viewChart')}</Text>
        </Pressable>
      </View>

      <Text style={s.sectionTitle}>{t('balances.groupMembers')}</Text>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : fetchError ? (
        <View style={s.errorRow}>
          <MaterialIcons name="error-outline" size={16} color={C.orange} />
          <Text style={s.errorText}>{fetchError}</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.listContent}
        >
          {members.map((m) => {
            const initials = m.display_name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);
            const isOwed = m.balance_cents > 0;
            const amtText = format(m.balance_cents);

            return (
              <View key={m.id} style={s.memberCard}>
                <View style={s.memberLeft}>
                  {m.avatar_url ? (
                    <Image
                      source={{ uri: m.avatar_url }}
                      style={s.memberAvatar}
                    />
                  ) : (
                    <View
                      style={[
                        s.memberAvatar,
                        m.isCurrentUser ? s.meAvatar : s.defaultAvatar,
                      ]}
                    >
                      <Text
                        style={[
                          s.memberInitials,
                          m.isCurrentUser && { color: C.bg },
                        ]}
                      >
                        {initials}
                      </Text>
                    </View>
                  )}
                  <View>
                    <Text
                      style={[
                        s.memberName,
                        m.isCurrentUser && { color: C.primary },
                      ]}
                    >
                      {m.isCurrentUser ? t('balances.me') : m.display_name}
                    </Text>
                    {m.isCurrentUser && <Text style={s.memberSub}>{t('balances.you')}</Text>}
                  </View>
                </View>

                <View style={s.memberRight}>
                  {m.balance_cents === 0 ? (
                    <Text style={s.settledText}>{t('balances.settledUp')}</Text>
                  ) : (
                    <View style={s.balanceInfo}>
                      <Text
                        style={[
                          s.balanceText,
                          { color: isOwed ? C.primary : C.orange },
                        ]}
                      >
                        {isOwed ? t('balances.owesYou', { amount: amtText }) : t('balances.youOwe', { amount: amtText })}
                      </Text>
                      {!m.isCurrentUser && (!isOwed || myMemberId) && (
                        <Pressable
                          style={s.settleBtn}
                          onPress={() =>
                            router.push({
                              pathname: '/settle-up',
                              params: {
                                groupId,
                                groupName,
                                friendName: m.display_name,
                                amountCents: String(Math.abs(m.balance_cents)),
                                // isOwed=true: they owe me → they are payer, I am payee
                                // isOwed=false: I owe them → I am payer (RPC default), they are payee
                                ...(isOwed
                                  ? {
                                      payerMemberId: m.id,
                                      friendMemberId: myMemberId ?? '',
                                    }
                                  : { friendMemberId: m.id }),
                              },
                            })
                          }
                        >
                          <Text style={s.settleBtnText}>
                            {isOwed ? t('balances.settleUpBtn') : t('balances.pay')}
                          </Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  backBtn: { padding: 10 },
  headerTitle: {
    flex: 1,
    color: C.white,
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  bannerLeft: { gap: 4 },
  bannerAmount: { fontSize: 28, fontWeight: '700' },
  bannerSub: { color: C.slate400, fontSize: 13 },
  chartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceHL,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  chartBtnText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  sectionTitle: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  memberLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberAvatar: { width: 48, height: 48, borderRadius: 24 },
  meAvatar: {
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultAvatar: {
    backgroundColor: C.surfaceHL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitials: { color: C.primary, fontWeight: '700', fontSize: 16 },
  memberName: { color: C.white, fontWeight: '700', fontSize: 15 },
  memberSub: { color: C.slate400, fontSize: 12 },
  memberRight: { alignItems: 'flex-end' },
  settledText: { color: C.slate400, fontWeight: '600', fontSize: 13 },
  balanceInfo: { alignItems: 'flex-end', gap: 6 },
  balanceText: { fontWeight: '600', fontSize: 14 },
  settleBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  settleBtnText: { color: C.bg, fontWeight: '700', fontSize: 13 },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    marginTop: 40,
  },
  errorText: { color: C.orange, fontSize: 13, flex: 1 },
});
