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
  isMe: boolean;
  size: number;
}

function Avatar({ url, name, isMe, size }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return <Image source={{ uri: url }} style={dim} contentFit="cover" />;
  }
  return (
    <View style={[dim, s.avatarFallback, isMe ? s.avatarMe : s.avatarDefault]}>
      <Text style={[s.avatarInitials, isMe && { color: C.bg }]}>{initials(name)}</Text>
    </View>
  );
}

export default function GroupBalancesScreen() {
  const { t } = useTranslation();
  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [rows, setRows] = useState<MemberBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!user || !groupId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('get_all_group_balances', {
      p_group_id: groupId,
    });
    if (err) {
      setError(err.message);
    } else {
      const mapped = ((data as MemberBalance[]) ?? [])
        .filter((r) => r.currency_code != null && Number(r.balance_cents) !== 0)
        .map((r) => ({ ...r, balance_cents: Number(r.balance_cents) }));
      setRows(mapped);
    }
    setLoading(false);
  }, [groupId, user]);

  // Re-fetch on focus so balances update after recording a settlement.
  useFocusEffect(useCallback(() => { fetchBalances(); }, [fetchBalances]));

  const plan = useMemo(() => simplifyDebts(rows), [rows]);

  // Per-member net balances grouped by currency (largest magnitude first).
  const summaryByCurrency = useMemo(() => {
    const map = new Map<string, MemberBalance[]>();
    for (const r of rows) {
      const list = map.get(r.currency_code);
      if (list) list.push(r);
      else map.set(r.currency_code, [r]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency_code, members]) => ({
        currency_code,
        members: [...members].sort(
          (a, b) => Math.abs(b.balance_cents) - Math.abs(a.balance_cents),
        ),
      }));
  }, [rows]);

  // Settlement plan grouped by currency.
  const planByCurrency = useMemo(() => {
    const map = new Map<string, SettlementTransaction[]>();
    for (const tx of plan) {
      const list = map.get(tx.currency_code);
      if (list) list.push(tx);
      else map.set(tx.currency_code, [tx]);
    }
    return [...map.entries()].map(([currency_code, transactions]) => ({
      currency_code,
      transactions,
    }));
  }, [plan]);

  const goSettle = useCallback(
    (tx: SettlementTransaction) => {
      if (!groupId || !user) return;
      const iAmDebtor = tx.from_user_id === user.id;
      const iAmCreditor = tx.to_user_id === user.id;
      if (!iAmDebtor && !iAmCreditor) return; // third-party rows are display-only
      if (iAmDebtor) {
        // I pay the creditor — I am the payer (no payerMemberId).
        router.push({
          pathname: '/settle-up',
          params: {
            groupId,
            groupName: groupName ?? '',
            friendName: tx.to_name ?? '',
            friendMemberId: tx.to_member_id,
            amountCents: String(tx.amount_cents),
            currencyCode: tx.currency_code,
          },
        });
      } else {
        // The debtor pays me — I am the payee, they are the payer.
        router.push({
          pathname: '/settle-up',
          params: {
            groupId,
            groupName: groupName ?? '',
            friendName: tx.from_name ?? '',
            friendMemberId: tx.to_member_id, // = my member id (I am the creditor)
            amountCents: String(tx.amount_cents),
            currencyCode: tx.currency_code,
            payerMemberId: tx.from_member_id,
          },
        });
      }
    },
    [groupId, groupName, user],
  );

  const multiCurrency = summaryByCurrency.length > 1;

  return (
    <View style={[s.container, { paddingTop: insets.top }]} testID="group-balances-screen">
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => router.back()} testID="balances-back-btn">
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>{t('balances.whoPaysWhom')}</Text>
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
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <MaterialIcons name="check-circle-outline" size={52} color={C.surfaceHL} />
          <Text style={s.emptyText}>{t('balances.allSettled')}</Text>
          <Text style={s.emptySub}>{t('balances.allSettledSub')}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {/* Per-person net summary */}
          <Text style={s.sectionTitle}>{t('balances.summaryTitle')}</Text>
          {summaryByCurrency.map(({ currency_code, members }) => (
            <View key={`sum-${currency_code}`} style={s.card}>
              {multiCurrency ? <Text style={s.currencyHeader}>{currency_code}</Text> : null}
              {members.map((m) => {
                const isMe = m.user_id === user?.id;
                const owed = m.balance_cents > 0;
                const name = isMe ? t('balances.you') : m.display_name ?? t('group.unknownMember');
                return (
                  <View key={`${m.member_id}-${currency_code}`} style={s.summaryRow}>
                    <Avatar url={m.avatar_url} name={m.display_name} isMe={isMe} size={36} />
                    <Text style={s.summaryName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[s.summaryAmount, { color: owed ? C.primary : C.orange }]}>
                      {owed ? '+' : '−'}
                      {formatCentsWithCurrency(Math.abs(m.balance_cents), currency_code)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}

          {/* Who pays whom */}
          <Text style={s.sectionTitle}>{t('balances.whoPaysWhom')}</Text>
          {planByCurrency.map(({ currency_code, transactions }) => (
            <View key={`plan-${currency_code}`}>
              {multiCurrency ? <Text style={s.currencyHeader}>{currency_code}</Text> : null}
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
                  label = t('balances.namePaysYou', {
                    name: tx.from_name ?? t('group.unknownMember'),
                  });
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
                    <View style={s.txnAvatars}>
                      <Avatar url={tx.from_avatar_url} name={tx.from_name} isMe={iAmDebtor} size={28} />
                      <MaterialIcons name="arrow-forward" size={14} color={C.slate400} />
                      <Avatar url={tx.to_avatar_url} name={tx.to_name} isMe={iAmCreditor} size={28} />
                    </View>
                    <Text style={[s.txnLabel, { color }]} numberOfLines={2}>
                      {label}
                    </Text>
                    <Text style={[s.txnAmount, { color }]}>
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
                        s.txnCard,
                        iAmDebtor ? s.txnCardOwe : s.txnCardOwed,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => goSettle(tx)}
                    >
                      {inner}
                    </Pressable>
                  );
                }
                return (
                  <View key={`${currency_code}-${i}`} style={s.txnCard}>
                    {inner}
                  </View>
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
  sectionTitle: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 8,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  currencyHeader: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  summaryName: { flex: 1, color: C.white, fontWeight: '600', fontSize: 15 },
  summaryAmount: { fontSize: 15, fontWeight: '700' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarMe: { backgroundColor: C.primary },
  avatarDefault: { backgroundColor: C.surfaceHL },
  avatarInitials: { color: C.primary, fontWeight: '700', fontSize: 12 },
  txnCard: {
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
  txnCardOwe: { borderColor: C.orange, backgroundColor: 'rgba(249,115,22,0.08)' },
  txnCardOwed: { borderColor: C.primary, backgroundColor: 'rgba(23,232,107,0.08)' },
  txnAvatars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  txnLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  txnAmount: { fontSize: 15, fontWeight: '700' },
});
