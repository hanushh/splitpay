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
import { formatCentsWithCurrency } from '@/context/currency';
import { type CurrencyBalance, sortBalancesDesc } from '@/lib/balance-utils';
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
  user_id: string | null;
  balances: CurrencyBalance[];
  isCurrentUser: boolean;
}

interface PairwiseBalance {
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  currency_code: string;
  balance_cents: number; // > 0: they owe me, < 0: I owe them
}

function getBalanceForCurrency(
  member: MemberBalance,
  currencyCode: string,
): number {
  return (
    member.balances.find((b) => b.currency_code === currencyCode)
      ?.balance_cents ?? 0
  );
}

function findBestPayee(
  members: MemberBalance[],
  excludeId: string,
  currencyCode: string,
): MemberBalance | null {
  return (
    members
      .filter((m) => m.id !== excludeId)
      .filter((m) => getBalanceForCurrency(m, currencyCode) > 0)
      .sort(
        (a, b) =>
          getBalanceForCurrency(b, currencyCode) -
          getBalanceForCurrency(a, currencyCode),
      )[0] ?? null
  );
}

function findBestPayer(
  members: MemberBalance[],
  excludeId: string,
  currencyCode: string,
): MemberBalance | null {
  return (
    members
      .filter((m) => m.id !== excludeId)
      .filter((m) => getBalanceForCurrency(m, currencyCode) < 0)
      .sort(
        (a, b) =>
          getBalanceForCurrency(a, currencyCode) -
          getBalanceForCurrency(b, currencyCode),
      )[0] ?? null
  );
}

export default function GroupBalancesScreen() {
  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName: string;
  }>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [members, setMembers] = useState<MemberBalance[]>([]);
  const [myBalances, setMyBalances] = useState<CurrencyBalance[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pairwise, setPairwise] = useState<PairwiseBalance[]>([]);

  const fetchBalances = useCallback(async () => {
    if (!user || !groupId) return;
    setFetchError(null);

    const [{ data: rpcRows, error: rpcErr }, { data: pairwiseRows }] =
      await Promise.all([
        supabase.rpc('get_all_group_balances', { p_group_id: groupId }),
        supabase.rpc('get_group_member_balances', {
          p_group_id: groupId,
          p_user_id: user.id,
        }),
      ]);

    if (rpcErr) {
      setFetchError(rpcErr.message ?? 'Failed to load balances.');
      setLoading(false);
      return;
    }

    type RpcRow = {
      member_id: string;
      user_id: string | null;
      display_name: string | null;
      avatar_url: string | null;
      currency_code: string | null;
      balance_cents: number | null;
    };

    const rows = (rpcRows as RpcRow[]) ?? [];

    // Group rows by member — one member can have multiple currency rows
    const memberMap = new Map<string, MemberBalance>();
    for (const r of rows) {
      let m = memberMap.get(r.member_id);
      if (!m) {
        m = {
          id: r.member_id,
          display_name: r.display_name ?? 'Unknown',
          avatar_url: r.avatar_url,
          user_id: r.user_id,
          isCurrentUser: r.user_id === user.id,
          balances: [],
        };
        memberMap.set(r.member_id, m);
      }
      const cents = Number(r.balance_cents ?? 0);
      if (r.currency_code && cents !== 0) {
        m.balances.push({
          currency_code: r.currency_code,
          balance_cents: cents,
        });
      }
    }
    const memberList: MemberBalance[] = Array.from(memberMap.values()).map(
      (m) => ({ ...m, balances: sortBalancesDesc(m.balances) }),
    );

    // Current user first, then sort others by absolute balance descending
    memberList.sort((a, b) => {
      if (a.isCurrentUser) return -1;
      if (b.isCurrentUser) return 1;
      const absA = a.balances.reduce(
        (s, x) => s + Math.abs(x.balance_cents),
        0,
      );
      const absB = b.balances.reduce(
        (s, x) => s + Math.abs(x.balance_cents),
        0,
      );
      return absB - absA;
    });

    const myMember = memberList.find((m) => m.isCurrentUser);

    type PairwiseRow = {
      member_id: string;
      display_name: string | null;
      avatar_url: string | null;
      currency_code: string;
      balance_cents: number;
    };
    const pwRows = (pairwiseRows as PairwiseRow[]) ?? [];
    const pw: PairwiseBalance[] = pwRows
      .filter((r) => Number(r.balance_cents) !== 0)
      .map((r) => ({
        member_id: r.member_id,
        display_name: r.display_name ?? 'Unknown',
        avatar_url: r.avatar_url,
        currency_code: r.currency_code,
        balance_cents: Number(r.balance_cents),
      }));

    setPairwise(pw);
    setMyBalances(myMember ? myMember.balances : []);
    setMyMemberId(myMember?.id ?? null);
    setMembers(memberList);
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

  const isAllSettled = myBalances.length === 0;
  const primaryBalance = myBalances[0];

  // Group-wide pending settlement summary (sum of positive balances per currency
  // — equals total amount owed across the group). Excludes the current user
  // from the "members pending" count so it reads as "others still owing".
  const groupPendingByCurrency = members.reduce<Record<string, number>>(
    (acc, m) => {
      m.balances.forEach((b) => {
        if (b.balance_cents > 0) {
          acc[b.currency_code] = (acc[b.currency_code] ?? 0) + b.balance_cents;
        }
      });
      return acc;
    },
    {},
  );
  const pendingMembersCount = members.filter(
    (m) => !m.isCurrentUser && m.balances.length > 0,
  ).length;
  const groupHasPending = Object.keys(groupPendingByCurrency).length > 0;

  const handleSettle = (m: MemberBalance, b: CurrencyBalance) => {
    const memberBal = b.balance_cents;
    if (memberBal < 0) {
      // Member owes money → they are the payer
      const bestPayee = findBestPayee(members, m.id, b.currency_code);
      if (!bestPayee) return;
      const payeeBal = getBalanceForCurrency(bestPayee, b.currency_code);
      const isThirdParty = myMemberId !== bestPayee.id;
      router.push({
        pathname: '/settle-up',
        params: {
          groupId,
          groupName,
          payerMemberId: m.id,
          payerName: m.display_name,
          friendMemberId: bestPayee.id,
          friendName: bestPayee.display_name,
          amountCents: String(Math.min(Math.abs(memberBal), payeeBal)),
          currencyCode: b.currency_code,
          ...(isThirdParty ? { isThirdParty: 'true' } : {}),
        },
      });
    } else {
      // Member is owed → they are the payee
      const myNetBal = myMemberId
        ? (members.find((x) => x.id === myMemberId)
            ?.balances.find((x) => x.currency_code === b.currency_code)
            ?.balance_cents ?? 0)
        : 0;

      if (myNetBal < 0) {
        // Current user owes money → current user pays this member
        router.push({
          pathname: '/settle-up',
          params: {
            groupId,
            groupName,
            friendMemberId: m.id,
            friendName: m.display_name,
            amountCents: String(Math.min(memberBal, Math.abs(myNetBal))),
            currencyCode: b.currency_code,
          },
        });
      } else {
        // Third-party: find the member who owes the most as payer
        const bestPayer = findBestPayer(members, m.id, b.currency_code);
        if (!bestPayer) return;
        const payerBal = Math.abs(
          getBalanceForCurrency(bestPayer, b.currency_code),
        );
        router.push({
          pathname: '/settle-up',
          params: {
            groupId,
            groupName,
            payerMemberId: bestPayer.id,
            payerName: bestPayer.display_name,
            friendMemberId: m.id,
            friendName: m.display_name,
            amountCents: String(Math.min(memberBal, payerBal)),
            currencyCode: b.currency_code,
            isThirdParty: 'true',
          },
        });
      }
    }
  };

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
        {isAllSettled ? (
          <Text style={[s.bannerAmount, { color: C.primary }]}>
            {t('balances.allSettled')}
          </Text>
        ) : (
          myBalances.map((b) => (
            <Text
              key={b.currency_code}
              style={[
                s.bannerAmount,
                { color: b.balance_cents > 0 ? C.primary : C.orange },
              ]}
            >
              {b.balance_cents > 0 ? '+' : '-'}
              {formatCentsWithCurrency(b.balance_cents, b.currency_code)}
            </Text>
          ))
        )}
        <Text style={s.bannerSub}>
          {isAllSettled
            ? t('balances.allSettledTotal')
            : primaryBalance && primaryBalance.balance_cents > 0
              ? t('balances.youAreOwedTotal')
              : t('balances.youOweTotal')}
        </Text>
      </View>

      {/* Group-wide pending summary */}
      {groupHasPending && (
        <View style={s.summaryCard}>
          <View style={s.summaryHeader}>
            <MaterialIcons name="hourglass-empty" size={16} color={C.orange} />
            <Text style={s.summaryTitle}>
              {t('balances.groupPendingTitle', { count: pendingMembersCount })}
            </Text>
          </View>
          <View style={s.summaryAmounts}>
            {Object.entries(groupPendingByCurrency).map(([code, cents]) => (
              <Text key={code} style={s.summaryAmount}>
                {formatCentsWithCurrency(cents, code)}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Your pending settlements (pairwise quick-action list) */}
      {pairwise.length > 0 && (
        <>
          <Text style={s.sectionTitle}>{t('balances.yourPending')}</Text>
          <View style={s.pairwiseList}>
            {pairwise.map((p) => {
              const theyOweMe = p.balance_cents > 0;
              const amtText = formatCentsWithCurrency(
                Math.abs(p.balance_cents),
                p.currency_code,
              );
              return (
                <Pressable
                  key={`${p.member_id}-${p.currency_code}`}
                  style={s.pairwiseRow}
                  onPress={() => {
                    router.push({
                      pathname: '/settle-up',
                      params: {
                        groupId,
                        groupName,
                        friendName: p.display_name,
                        friendMemberId: theyOweMe ? (myMemberId ?? '') : p.member_id,
                        amountCents: String(Math.abs(p.balance_cents)),
                        currencyCode: p.currency_code,
                        ...(theyOweMe ? { payerMemberId: p.member_id } : {}),
                      },
                    });
                  }}
                >
                  <View style={s.pairwiseInfo}>
                    <Text style={s.pairwiseName}>{p.display_name}</Text>
                    <Text
                      style={[
                        s.pairwiseLabel,
                        { color: theyOweMe ? C.primary : C.orange },
                      ]}
                    >
                      {theyOweMe
                        ? t('balances.owesYou', { amount: amtText })
                        : t('balances.youOwe', { amount: amtText })}
                    </Text>
                  </View>
                  <View
                    style={[
                      s.pairwiseSettleBtn,
                      theyOweMe ? s.pairwiseSettleSolid : s.pairwiseSettleOutline,
                    ]}
                  >
                    <Text
                      style={[
                        s.pairwiseSettleText,
                        { color: theyOweMe ? C.bg : C.primary },
                      ]}
                    >
                      {theyOweMe ? t('balances.settleUpBtn') : t('balances.pay')}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

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
                    {m.isCurrentUser && (
                      <Text style={s.memberSub}>{t('balances.you')}</Text>
                    )}
                  </View>
                </View>

                <View style={s.memberRight}>
                  {m.balances.length === 0 ? (
                    <Text style={s.settledText}>{t('balances.settledUp')}</Text>
                  ) : (
                    m.balances.map((b) => {
                      const memberIsOwed = b.balance_cents > 0;
                      const amtText = formatCentsWithCurrency(
                        b.balance_cents,
                        b.currency_code,
                      );
                      return (
                        <View key={b.currency_code} style={s.currencyRow}>
                          <Text
                            style={[
                              s.balanceText,
                              { color: memberIsOwed ? C.primary : C.orange },
                            ]}
                          >
                            {memberIsOwed
                              ? t('balances.isOwed', { amount: amtText })
                              : t('balances.owes', { amount: amtText })}
                          </Text>
                          {!m.isCurrentUser && (
                            <Pressable
                              style={s.settleBtn}
                              onPress={() => handleSettle(m, b)}
                            >
                              <Text style={s.settleBtnText}>
                                {memberIsOwed
                                  ? t('balances.settleUpBtn')
                                  : t('balances.recordPay')}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })
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
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    gap: 4,
  },
  bannerAmount: { fontSize: 22, fontWeight: '700' },
  bannerSub: { color: C.slate400, fontSize: 13 },
  summaryCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: 'rgba(249,115,22,0.08)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  summaryTitle: { color: C.white, fontSize: 13, fontWeight: '600', flex: 1 },
  summaryAmounts: { alignItems: 'flex-end', gap: 2 },
  summaryAmount: { color: C.orange, fontSize: 14, fontWeight: '700' },
  pairwiseList: { paddingHorizontal: 16, gap: 8, marginBottom: 18 },
  pairwiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    gap: 12,
  },
  pairwiseInfo: { flex: 1 },
  pairwiseName: { color: C.white, fontSize: 14, fontWeight: '700' },
  pairwiseLabel: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  pairwiseSettleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pairwiseSettleSolid: { backgroundColor: C.primary },
  pairwiseSettleOutline: {
    borderWidth: 1.5,
    borderColor: C.primary,
    backgroundColor: 'transparent',
  },
  pairwiseSettleText: { fontSize: 13, fontWeight: '700' },
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
    alignItems: 'flex-start',
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
  memberRight: { alignItems: 'flex-end', gap: 8 },
  settledText: { color: C.slate400, fontWeight: '600', fontSize: 13 },
  currencyRow: { alignItems: 'flex-end', gap: 4 },
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
