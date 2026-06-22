import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  type MemberBalance,
  type SettlementTransaction,
  simplifyDebts,
} from '@/lib/balance-utils';
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

function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

interface AvatarProps {
  url: string | null;
  name: string | null;
  size: number;
}

function Avatar({ url, name, size }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return <Image source={{ uri: url }} style={dim} contentFit="cover" />;
  }
  return (
    <View style={[dim, s.avatarFallback]}>
      <Text style={s.avatarInitials}>{initials(name)}</Text>
    </View>
  );
}

/**
 * The current user's net balance with one other member, in one currency, as
 * returned by `get_group_member_balances` (used when minimize is OFF).
 * `balance_cents` > 0 => that member owes you; < 0 => you owe that member.
 */
interface MyBalanceRow {
  member_id: string;
  display_name: string | null;
  avatar_url: string | null;
  currency_code: string;
  balance_cents: number;
}

export default function GroupBalancesScreen() {
  const { t } = useTranslation();
  const { groupId, groupName, simplify } = useLocalSearchParams<{
    groupId: string;
    groupName: string;
    simplify?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Minimized cross-person plan is the default; '0' opts into per-person.
  const minimize = simplify !== '0';

  // Minimized-plan transactions (minimize ON).
  const [plan, setPlan] = useState<SettlementTransaction[]>([]);
  // The current user's per-person balances (minimize OFF).
  const [myBalances, setMyBalances] = useState<MyBalanceRow[]>([]);
  const [myMemberId, setMyMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!user || !groupId) return;
    setLoading(true);
    setError(null);

    if (minimize) {
      const { data, error: err } = await supabase.rpc('get_all_group_balances', {
        p_group_id: groupId,
      });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const rows = ((data as MemberBalance[]) ?? [])
        .filter((r) => r.currency_code != null && Number(r.balance_cents) !== 0)
        .map((r) => ({ ...r, balance_cents: Number(r.balance_cents) }));
      setPlan(simplifyDebts(rows));
    } else {
      const [mineRes, memberRes] = await Promise.all([
        supabase.rpc('get_group_member_balances', { p_group_id: groupId, p_user_id: user.id }),
        supabase
          .from('group_members')
          .select('id')
          .eq('group_id', groupId)
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      if (mineRes.error) {
        setError(mineRes.error.message);
        setLoading(false);
        return;
      }
      setMyBalances(
        ((mineRes.data as MyBalanceRow[]) ?? [])
          .filter((r) => r.currency_code != null && Number(r.balance_cents) !== 0)
          .map((r) => ({ ...r, balance_cents: Number(r.balance_cents) })),
      );
      setMyMemberId((memberRes.data as { id: string } | null)?.id ?? null);
    }
    setLoading(false);
  }, [groupId, user, minimize]);

  // Re-fetch on focus so the list updates after recording a settlement.
  useFocusEffect(useCallback(() => { fetchBalances(); }, [fetchBalances]));

  // Minimized plan grouped by currency.
  const planByCurrency = useMemo(() => {
    const map = new Map<string, SettlementTransaction[]>();
    for (const tx of plan) {
      const list = map.get(tx.currency_code);
      if (list) list.push(tx);
      else map.set(tx.currency_code, [tx]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency_code, transactions]) => ({ currency_code, transactions }));
  }, [plan]);

  // Per-person balances grouped by currency (largest first).
  const settleByCurrency = useMemo(() => {
    const map = new Map<string, MyBalanceRow[]>();
    for (const r of myBalances) {
      const list = map.get(r.currency_code);
      if (list) list.push(r);
      else map.set(r.currency_code, [r]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency_code, items]) => ({
        currency_code,
        items: [...items].sort(
          (a, b) => Math.abs(b.balance_cents) - Math.abs(a.balance_cents),
        ),
      }));
  }, [myBalances]);

  // minimize ON: settle a plan transaction that involves the current user.
  const goSettlePlan = useCallback(
    (tx: SettlementTransaction) => {
      if (!groupId || !user) return;
      const iAmDebtor = tx.from_user_id === user.id;
      const iAmCreditor = tx.to_user_id === user.id;
      if (!iAmDebtor && !iAmCreditor) return; // third-party rows are display-only
      router.push({
        pathname: '/settle-up',
        params: iAmDebtor
          ? {
              groupId,
              groupName: groupName ?? '',
              friendName: tx.to_name ?? '',
              friendMemberId: tx.to_member_id,
              amountCents: String(tx.amount_cents),
              currencyCode: tx.currency_code,
            }
          : {
              groupId,
              groupName: groupName ?? '',
              friendName: tx.from_name ?? '',
              friendMemberId: tx.to_member_id, // = my member id (I am the creditor)
              amountCents: String(tx.amount_cents),
              currencyCode: tx.currency_code,
              payerMemberId: tx.from_member_id,
            },
      });
    },
    [groupId, groupName, user],
  );

  // minimize OFF: settle a per-person balance.
  const goSettlePerson = useCallback(
    (row: MyBalanceRow) => {
      if (!groupId || !user) return;
      const theyOweMe = row.balance_cents > 0;
      router.push({
        pathname: '/settle-up',
        params: {
          groupId,
          groupName: groupName ?? '',
          friendName: row.display_name ?? '',
          friendMemberId: theyOweMe ? (myMemberId ?? '') : row.member_id,
          amountCents: String(Math.abs(row.balance_cents)),
          currencyCode: row.currency_code,
          ...(theyOweMe ? { payerMemberId: row.member_id } : {}),
        },
      });
    },
    [groupId, groupName, user, myMemberId],
  );

  const multiCurrencyPlan = planByCurrency.length > 1;
  const multiCurrencyPerson = settleByCurrency.length > 1;
  const isEmpty = minimize ? plan.length === 0 : myBalances.length === 0;

  return (
    <View style={[s.container, { paddingTop: insets.top }]} testID="group-balances-screen">
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => router.back()} testID="balances-back-btn">
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>{t('balances.settleUpBtn')}</Text>
          {groupName ? (
            <Text style={s.headerSub} numberOfLines={1}>
              {groupName}
            </Text>
          ) : null}
        </View>
        <View style={s.iconBtn} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : isEmpty ? (
        <View style={s.center}>
          <MaterialIcons name="check-circle-outline" size={52} color={C.surfaceHL} />
          <Text style={s.emptyText}>{t('balances.allSettled')}</Text>
          <Text style={s.emptySub}>{t('balances.allSettledSub')}</Text>
        </View>
      ) : minimize ? (
        /* ── Minimized cross-person plan ── */
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          <Text style={s.prompt}>{t('balances.settleSelectPrompt')}</Text>
          {planByCurrency.map(({ currency_code, transactions }) => (
            <View key={`plan-${currency_code}`}>
              {multiCurrencyPlan ? <Text style={s.currencyHeader}>{currency_code}</Text> : null}
              {transactions.map((tx, i) => {
                const iAmDebtor = tx.from_user_id === user?.id;
                const iAmCreditor = tx.to_user_id === user?.id;
                const involved = iAmDebtor || iAmCreditor;

                let label: string;
                let color: string;
                if (iAmDebtor) {
                  label = t('balances.youPayName', { name: tx.to_name ?? t('group.unknownMember') });
                  color = C.orange;
                } else if (iAmCreditor) {
                  label = t('balances.namePaysYou', { name: tx.from_name ?? t('group.unknownMember') });
                  color = C.primary;
                } else {
                  label = t('balances.personPaysPerson', {
                    from: tx.from_name ?? t('group.unknownMember'),
                    to: tx.to_name ?? t('group.unknownMember'),
                  });
                  color = C.white;
                }

                const inner = (
                  <>
                    <View style={s.planAvatars}>
                      <Avatar url={tx.from_avatar_url} name={tx.from_name} size={28} />
                      <MaterialIcons name="arrow-forward" size={14} color={C.slate400} />
                      <Avatar url={tx.to_avatar_url} name={tx.to_name} size={28} />
                    </View>
                    <Text style={[s.planLabel, { color }]} numberOfLines={2}>
                      {label}
                    </Text>
                    <Text style={[s.rowAmount, { color }]}>
                      {formatCentsWithCurrency(tx.amount_cents, tx.currency_code)}
                    </Text>
                    {involved ? (
                      <MaterialIcons name="chevron-right" size={20} color={C.primary} />
                    ) : null}
                  </>
                );

                if (involved) {
                  return (
                    <Pressable
                      key={`${currency_code}-${i}`}
                      testID={`settle-row-${currency_code}-${i}`}
                      style={({ pressed }: { pressed: boolean }) => [
                        s.row,
                        iAmDebtor ? s.rowOwe : s.rowOwed,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => goSettlePlan(tx)}
                    >
                      {inner}
                    </Pressable>
                  );
                }
                return (
                  <View key={`${currency_code}-${i}`} style={s.row}>
                    {inner}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      ) : (
        /* ── Your actual per-person balances ── */
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          <Text style={s.prompt}>{t('balances.settleSelectPrompt')}</Text>
          {settleByCurrency.map(({ currency_code, items }) => (
            <View key={`settle-${currency_code}`}>
              {multiCurrencyPerson ? <Text style={s.currencyHeader}>{currency_code}</Text> : null}
              {items.map((row) => {
                const theyOweMe = row.balance_cents > 0;
                const name = row.display_name ?? t('group.unknownMember');
                const label = theyOweMe
                  ? t('balances.namePaysYou', { name })
                  : t('balances.youPayName', { name });
                const color = theyOweMe ? C.primary : C.orange;
                return (
                  <Pressable
                    key={`${row.member_id}-${currency_code}`}
                    testID={`settle-row-${row.member_id}-${currency_code}`}
                    style={({ pressed }: { pressed: boolean }) => [
                      s.row,
                      theyOweMe ? s.rowOwed : s.rowOwe,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => goSettlePerson(row)}
                  >
                    <Avatar url={row.avatar_url} name={row.display_name} size={40} />
                    <View style={s.rowText}>
                      <Text style={s.rowName} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[s.personLabel, { color }]} numberOfLines={1}>
                        {label}
                      </Text>
                    </View>
                    <Text style={[s.rowAmount, { color }]}>
                      {formatCentsWithCurrency(Math.abs(row.balance_cents), currency_code)}
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color={C.primary} />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 8 },
  iconBtn: { padding: 10, width: 44, alignItems: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  headerSub: { color: C.slate400, fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  errorText: { color: '#ff5252', fontSize: 14, textAlign: 'center' },
  emptyText: { color: C.white, fontWeight: '700', fontSize: 16, marginTop: 8 },
  emptySub: { color: C.slate400, fontSize: 13, textAlign: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  prompt: { color: C.slate400, fontSize: 13, marginBottom: 14 },
  currencyHeader: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 6,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceHL,
  },
  avatarInitials: { color: C.primary, fontWeight: '700', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  rowOwe: { borderColor: C.orange, backgroundColor: 'rgba(249,115,22,0.08)' },
  rowOwed: { borderColor: C.primary, backgroundColor: 'rgba(23,232,107,0.08)' },
  planAvatars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  planLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  rowText: { flex: 1 },
  rowName: { color: C.white, fontWeight: '700', fontSize: 15, marginBottom: 2 },
  personLabel: { fontSize: 13, fontWeight: '600' },
  rowAmount: { fontSize: 15, fontWeight: '700' },
});
