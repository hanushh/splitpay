import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
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
  slate500: '#64748b',
  white: '#ffffff',
  red: '#ef4444',
};

const CATEGORY_ICONS: Record<
  string,
  { icon: string; bg: string; color: string }
> = {
  restaurant: {
    icon: 'restaurant',
    bg: 'rgba(249,115,22,0.15)',
    color: '#f97316',
  },
  hotel: { icon: 'hotel', bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  train: { icon: 'train', bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
  store: {
    icon: 'local-convenience-store',
    bg: 'rgba(234,179,8,0.15)',
    color: '#eab308',
  },
  receipt: {
    icon: 'receipt-long',
    bg: 'rgba(23,232,107,0.15)',
    color: '#17e86b',
  },
  payment: { icon: 'payments', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
  settlement: {
    icon: 'payments',
    bg: 'rgba(23,232,107,0.15)',
    color: '#17e86b',
  },
};

interface ActivityRow {
  expense_id: string;
  group_id: string;
  group_name: string;
  description: string;
  total_amount_cents: number;
  category: string;
  created_at: string;
  paid_by_name: string;
  paid_by_avatar: string | null;
  paid_by_is_user: boolean;
  your_split_cents: number;
  payee_name?: string | null;
}

interface Section {
  title: string;
  data: ActivityRow[];
}

type FilterKey = 'all' | 'expenses' | 'settlements' | 'mine';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'settlements', label: 'Settlements' },
  { key: 'mine', label: 'My activity' },
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear())
    return 'This month';
  if (
    d.getMonth() === now.getMonth() - 1 &&
    d.getFullYear() === now.getFullYear()
  )
    return 'Last month';
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function ActivityCard({ item }: { item: ActivityRow }) {
  const { format } = useCurrency();
  const cat = CATEGORY_ICONS[item.category] ?? CATEGORY_ICONS.receipt;
  const paidLabel = item.paid_by_is_user ? 'You' : item.paid_by_name;
  const subtitle = `${paidLabel} paid ${format(item.total_amount_cents)}`;
  const yourAmount = item.paid_by_is_user
    ? item.total_amount_cents - item.your_split_cents
    : item.your_split_cents;
  const amountPositive = item.paid_by_is_user;
  const amountLabel = item.paid_by_is_user ? 'you lent' : 'you owe';

  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => [
        s.card,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: cat.bg }]}>
        <MaterialIcons
          name={cat.icon as keyof typeof MaterialIcons.glyphMap}
          size={22}
          color={cat.color}
        />
      </View>

      <View style={s.cardInfo}>
        <Text style={s.cardTitle} numberOfLines={1}>
          {item.description}
        </Text>
        <Text style={s.cardSubtitle} numberOfLines={1}>
          <Text style={s.groupTag}>{item.group_name}</Text>
          {'  ·  '}
          {subtitle}
        </Text>
        <Text style={s.timestamp}>{relativeTime(item.created_at)}</Text>
      </View>

      <View style={s.cardRight}>
        <Text
          style={[
            s.amountLabel,
            { color: amountPositive ? C.primary : C.orange },
          ]}
        >
          {amountLabel}
        </Text>
        <Text
          style={[
            s.cardAmount,
            { color: amountPositive ? C.primary : C.orange },
          ]}
        >
          {format(yourAmount)}
        </Text>
      </View>
    </Pressable>
  );
}

function SettlementCard({ item }: { item: ActivityRow }) {
  const { format } = useCurrency();
  const label = item.paid_by_is_user
    ? `You paid ${item.payee_name ?? 'someone'}`
    : `${item.paid_by_name ?? 'Someone'} paid you`;

  return (
    <Pressable
      style={({ pressed }: { pressed: boolean }) => [
        s.card,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[s.iconBox, { backgroundColor: 'rgba(23,232,107,0.15)' }]}>
        <MaterialIcons name="payments" size={22} color="#17e86b" />
      </View>
      <View style={s.cardInfo}>
        <Text style={s.cardTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={s.cardSubtitle} numberOfLines={1}>
          <Text style={s.groupTag}>{item.group_name}</Text>
        </Text>
        <Text style={s.timestamp}>{relativeTime(item.created_at)}</Text>
      </View>
      <View style={s.cardRight}>
        <Text style={[s.amountLabel, { color: '#17e86b' }]}>settled</Text>
        <Text style={[s.cardAmount, { color: '#17e86b' }]}>
          {format(item.total_amount_cents)}
        </Text>
      </View>
    </Pressable>
  );
}

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const fetchActivity = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('get_user_activity', {
      p_user_id: user.id,
      p_limit: 50,
    });
    if (error) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const seen = new Set<string>();
    const grouped: Record<string, ActivityRow[]> = {};
    for (const row of (data as ActivityRow[]) ?? []) {
      if (seen.has(row.expense_id)) continue;
      seen.add(row.expense_id);
      const key = monthKey(row.created_at);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    setSections(
      Object.entries(grouped).map(([title, d]) => ({ title, data: d })),
    );
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);
  const onRefresh = () => {
    setRefreshing(true);
    fetchActivity();
  };

  const filteredSections = useMemo(() => {
    if (activeFilter === 'all') return sections;
    return sections
      .map((sec) => ({
        ...sec,
        data: sec.data.filter((item) => {
          if (activeFilter === 'expenses')
            return item.category !== 'settlement';
          if (activeFilter === 'settlements')
            return item.category === 'settlement';
          if (activeFilter === 'mine') return item.paid_by_is_user;
          return true;
        }),
      }))
      .filter((sec) => sec.data.length > 0);
  }, [sections, activeFilter]);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Activity</Text>
        <View style={s.headerActions}>
          <Pressable style={s.headerIcon}>
            <MaterialIcons name="search" size={22} color={C.white} />
          </Pressable>
          <Pressable style={s.headerIcon}>
            <MaterialIcons name="filter-list" size={22} color={C.white} />
          </Pressable>
        </View>
      </View>

      {/* Filter pills */}
      <View style={s.pillRow}>
        {FILTERS.map(({ key, label }) => (
          <Pressable
            key={key}
            style={[s.pill, activeFilter === key && s.pillActive]}
            onPress={() => setActiveFilter(key)}
          >
            <Text
              style={[s.pillText, activeFilter === key && s.pillTextActive]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : (
        <SectionList
          sections={filteredSections}
          keyExtractor={(item: ActivityRow) => item.expense_id}
          renderItem={({ item }: { item: ActivityRow }) =>
            item.category === 'settlement' ? (
              <SettlementCard item={item} />
            ) : (
              <ActivityCard item={item} />
            )
          }
          renderSectionHeader={({ section }: { section: Section }) => (
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>{section.title.toUpperCase()}</Text>
            </View>
          )}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
            />
          }
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <MaterialIcons name="history" size={48} color={C.surfaceHL} />
              <Text style={s.emptyTitle}>No activity yet</Text>
              <Text style={s.emptySubtitle}>
                Add expenses to see your history here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 22 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerIcon: { padding: 6 },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  pillActive: { backgroundColor: C.surfaceHL, borderColor: C.primary },
  pillText: { color: C.slate400, fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: C.white },
  listContent: { paddingBottom: 100 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  sectionTitle: {
    color: C.slate400,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  settleBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: C.bg,
  },
  cardInfo: { flex: 1 },
  cardTitle: {
    color: C.white,
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  cardSubtitle: { color: C.slate400, fontSize: 12, marginBottom: 2 },
  groupTag: { color: C.primary, fontWeight: '600' },
  timestamp: { color: C.slate500, fontSize: 11 },
  cardRight: { alignItems: 'flex-end' },
  amountLabel: { fontSize: 11, fontWeight: '600' },
  cardAmount: { fontSize: 15, fontWeight: '700' },
  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
    paddingHorizontal: 32,
  },
  emptyTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  emptySubtitle: { color: C.slate400, fontSize: 14, textAlign: 'center' },
});
