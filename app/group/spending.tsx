import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from 'react-native';

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
  slate500: '#64748b',
  white: '#ffffff',
};

const CATEGORY_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  restaurant: { icon: 'restaurant', bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  hotel: { icon: 'hotel', bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  train: { icon: 'train', bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
  store: { icon: 'local-convenience-store', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  receipt: { icon: 'receipt-long', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
};

interface Expense {
  expense_id: string;
  category: string;
  total_amount_cents: number;
  description: string;
  created_at: string;
}

interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

export default function SpendingScreen() {
  const { groupId, groupName } = useLocalSearchParams<{ groupId: string; groupName: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async () => {
    if (!user || !groupId) return;
    setLoading(true);
    const { data, error: err } = await supabase.rpc('get_group_expenses', {
      p_group_id: groupId,
      p_user_id: user.id,
    });
    if (err) {
      setError(err.message);
    } else {
      // Deduplicate
      const seen = new Set<string>();
      const deduped = ((data as Expense[]) ?? []).filter((e) => {
        if (seen.has(e.expense_id)) return false;
        seen.add(e.expense_id);
        return true;
      });
      setExpenses(deduped);
    }
    setLoading(false);
  }, [groupId, user]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const totals: CategoryTotal[] = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    for (const e of expenses) {
      if (e.category === 'settlement') continue;
      if (!map[e.category]) map[e.category] = { total: 0, count: 0 };
      map[e.category].total += e.total_amount_cents;
      map[e.category].count += 1;
    }
    return Object.entries(map)
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total);
  }, [expenses]);

  const grandTotal = useMemo(
    () => totals.reduce((sum, t) => sum + t.total, 0),
    [totals],
  );

  const max = totals.length > 0 ? totals[0].total : 1;

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>Spending</Text>
          {groupName ? <Text style={s.headerSub} numberOfLines={1}>{groupName}</Text> : null}
        </View>
        <View style={s.backBtn} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : totals.length === 0 ? (
        <View style={s.center}>
          <MaterialIcons name="bar-chart" size={52} color={C.surfaceHL} />
          <Text style={s.emptyText}>No spending data yet</Text>
          <Text style={s.emptySub}>Add expenses to see spending by category</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {/* Grand total card */}
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>TOTAL GROUP SPEND</Text>
            <Text style={s.totalAmount}>{format(grandTotal)}</Text>
            <Text style={s.totalSub}>{totals.reduce((n, t) => n + t.count, 0)} expenses across {totals.length} {totals.length === 1 ? 'category' : 'categories'}</Text>
          </View>

          {/* Chart */}
          <View style={s.chartCard}>
            <Text style={s.sectionLabel}>BREAKDOWN</Text>
            {totals.map(({ category, total, count }) => {
              const cat = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.receipt;
              const fillRatio = total / max;
              const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
              return (
                <View key={category} style={s.row}>
                  {/* Icon */}
                  <View style={[s.iconBox, { backgroundColor: cat.bg }]}>
                    <MaterialIcons
                      name={cat.icon as keyof typeof MaterialIcons.glyphMap}
                      size={20}
                      color={cat.color}
                    />
                  </View>

                  {/* Label + bar */}
                  <View style={s.barSection}>
                    <View style={s.rowTop}>
                      <Text style={s.catLabel}>{category.charAt(0).toUpperCase() + category.slice(1)}</Text>
                      <Text style={s.catCount}>{count} {count === 1 ? 'expense' : 'expenses'}</Text>
                    </View>
                    <View style={s.barTrack}>
                      <View
                        style={[
                          s.barFill,
                          { flex: fillRatio, backgroundColor: cat.color + '55' },
                        ]}
                      />
                      <View style={{ flex: 1 - fillRatio }} />
                    </View>
                  </View>

                  {/* Amount + % */}
                  <View style={s.amountCol}>
                    <Text style={[s.amount, { color: cat.color }]}>{format(total)}</Text>
                    <Text style={s.pct}>{pct}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
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
  backBtn: { padding: 10, width: 44 },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  headerSub: { color: C.slate400, fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  errorText: { color: '#ff5252', fontSize: 14 },
  emptyText: { color: C.white, fontWeight: '700', fontSize: 16, marginTop: 8 },
  emptySub: { color: C.slate400, fontSize: 13 },
  scroll: { padding: 16, paddingBottom: 40 },
  totalCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    alignItems: 'center',
  },
  totalLabel: { color: C.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  totalAmount: { color: C.white, fontSize: 36, fontWeight: '700', marginBottom: 4 },
  totalSub: { color: C.slate400, fontSize: 13 },
  chartCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  sectionLabel: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barSection: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catLabel: { color: C.white, fontWeight: '600', fontSize: 14 },
  catCount: { color: C.slate500, fontSize: 11 },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: C.surfaceHL,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barFill: { borderRadius: 4 },
  amountCol: { alignItems: 'flex-end', gap: 2, minWidth: 64 },
  amount: { fontSize: 14, fontWeight: '700' },
  pct: { color: C.slate400, fontSize: 11 },
});
