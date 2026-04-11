import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';
import { useCurrency } from '@/context/currency';
import { supabase } from '@/lib/supabase';

const C = {
  primary: '#17e86b',
  primaryDark: '#0ea64c',
  orange: '#f97316',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

const CATEGORY_ICONS: Record<
  string,
  { icon: string; bg: string; color: string; emoji: string }
> = {
  restaurant: {
    icon: 'restaurant',
    bg: 'rgba(249,115,22,0.15)',
    color: '#f97316',
    emoji: '🍽',
  },
  hotel: {
    icon: 'hotel',
    bg: 'rgba(99,102,241,0.15)',
    color: '#818cf8',
    emoji: '🏨',
  },
  train: {
    icon: 'train',
    bg: 'rgba(20,184,166,0.15)',
    color: '#2dd4bf',
    emoji: '🚂',
  },
  store: {
    icon: 'local-convenience-store',
    bg: 'rgba(234,179,8,0.15)',
    color: '#eab308',
    emoji: '🛒',
  },
  receipt: {
    icon: 'receipt-long',
    bg: 'rgba(23,232,107,0.15)',
    color: '#17e86b',
    emoji: '🧾',
  },
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

// ─── Share Card Modal ────────────────────────────────────────────────────────

interface ShareCardProps {
  visible: boolean;
  onClose: () => void;
  groupName: string;
  grandTotal: number;
  totals: CategoryTotal[];
  format: (cents: number) => string;
}

function ShareCardModal({
  visible,
  onClose,
  groupName,
  grandTotal,
  totals,
  format,
}: ShareCardProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const handleShare = useCallback(async () => {
    const lines: string[] = [
      `💰 ${groupName} — ${t('spending.expenseSummary')}`,
      ``,
      `${t('spending.totalSpent')}: ${format(grandTotal)}`,
      ``,
      `By category:`,
    ];
    for (const { category, total } of totals) {
      const cat = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.receipt;
      const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
      const cap = category.charAt(0).toUpperCase() + category.slice(1);
      lines.push(`${cat.emoji}  ${cap.padEnd(14)} ${format(total)}  (${pct}%)`);
    }
    lines.push(``, t('spending.sharedVia'));

    await Share.share({ message: lines.join('\n') });
  }, [groupName, grandTotal, totals, format, t]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={m.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View
          style={[m.sheet, { paddingBottom: insets.bottom + 16 }]}
          testID="share-card-sheet"
        >
          <View style={m.handle} />
          <Text style={m.sheetTitle}>{t('spending.shareSummary')}</Text>

          {/* Preview card */}
          <View style={m.card}>
            {/* Card header */}
            <View style={m.cardHeader}>
              <View style={m.cardIconWrap}>
                <MaterialIcons name="bar-chart" size={20} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={m.cardGroup} numberOfLines={1}>
                  {groupName}
                </Text>
                <Text style={m.cardSubtitle}>{t('spending.expenseSummary')}</Text>
              </View>
            </View>

            <View style={m.divider} />

            {/* Total */}
            <View style={m.cardTotal}>
              <Text style={m.cardTotalLabel}>{t('spending.totalSpent')}</Text>
              <Text style={m.cardTotalAmount}>{format(grandTotal)}</Text>
            </View>

            <View style={m.divider} />

            {/* Category rows */}
            {totals.map(({ category, total }) => {
              const cat = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.receipt;
              const pct =
                grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
              const cap = category.charAt(0).toUpperCase() + category.slice(1);
              return (
                <View key={category} style={m.cardRow}>
                  <Text style={m.cardEmoji}>{cat.emoji}</Text>
                  <Text style={m.cardCat}>{cap}</Text>
                  <View style={m.cardBarWrap}>
                    <View style={m.cardBarTrack}>
                      <View
                        style={[
                          m.cardBarFill,
                          {
                            flex: total / (totals[0]?.total ?? 1),
                            backgroundColor: cat.color + '66',
                          },
                        ]}
                      />
                      <View
                        style={{ flex: 1 - total / (totals[0]?.total ?? 1) }}
                      />
                    </View>
                  </View>
                  <Text style={[m.cardAmt, { color: cat.color }]}>
                    {format(total)}
                  </Text>
                  <Text style={m.cardPct}>{pct}%</Text>
                </View>
              );
            })}

            <View style={m.divider} />

            {/* Footer */}
            <Text style={m.cardFooter}>{t('spending.sharedVia')}</Text>
          </View>

          {/* Share button */}
          <Pressable
            testID="share-card-confirm-btn"
            style={({ pressed }: { pressed: boolean }) => [
              m.shareBtn,
              pressed && { opacity: 0.85 },
            ]}
            onPress={handleShare}
          >
            <MaterialIcons name="share" size={20} color={C.bg} />
            <Text style={m.shareBtnText}>{t('spending.share')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SpendingScreen() {
  const { t } = useTranslation();
  const { groupId, groupName } = useLocalSearchParams<{
    groupId: string;
    groupName: string;
  }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { format } = useCurrency();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);

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

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

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
  const hasData = totals.length > 0;

  return (
    <View
      style={[s.container, { paddingTop: insets.top }]}
      testID="spending-screen"
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable
          style={s.iconBtn}
          onPress={() => router.back()}
          testID="spending-back-btn"
        >
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <View style={s.headerText}>
          <Text style={s.headerTitle}>{t('spending.title')}</Text>
          {groupName ? (
            <Text style={s.headerSub} numberOfLines={1}>
              {groupName}
            </Text>
          ) : null}
        </View>
        <Pressable
          testID="spending-share-btn"
          style={[s.iconBtn, !hasData && { opacity: 0.3 }]}
          onPress={() => hasData && setShowShare(true)}
          disabled={!hasData}
        >
          <MaterialIcons name="ios-share" size={22} color={C.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : !hasData ? (
        <View style={s.center}>
          <MaterialIcons name="bar-chart" size={52} color={C.surfaceHL} />
          <Text style={s.emptyText}>{t('spending.noDataTitle')}</Text>
          <Text style={s.emptySub}>{t('spending.noDataSub')}</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.scroll}
        >
          {/* Grand total card */}
          <View style={s.totalCard}>
            <Text style={s.totalLabel}>{t('spending.totalGroupSpend')}</Text>
            <Text style={s.totalAmount}>{format(grandTotal)}</Text>
            <Text style={s.totalSub}>
              {t('spending.expenseCount', {
                count: totals.reduce((n, item) => n + item.count, 0),
                categories: totals.length,
                categoryLabel: totals.length === 1 ? t('spending.category') : t('spending.categories'),
              })}
            </Text>
          </View>

          {/* Chart */}
          <View style={s.chartCard}>
            <Text style={s.sectionLabel}>{t('spending.breakdown')}</Text>
            {totals.map(({ category, total, count }) => {
              const cat = CATEGORY_ICONS[category] ?? CATEGORY_ICONS.receipt;
              const fillRatio = total / max;
              const pct =
                grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
              return (
                <View key={category} style={s.row}>
                  <View style={[s.iconBox, { backgroundColor: cat.bg }]}>
                    <MaterialIcons
                      name={cat.icon as keyof typeof MaterialIcons.glyphMap}
                      size={20}
                      color={cat.color}
                    />
                  </View>
                  <View style={s.barSection}>
                    <View style={s.rowTop}>
                      <Text style={s.catLabel}>
                        {category.charAt(0).toUpperCase() + category.slice(1)}
                      </Text>
                      <Text style={s.catCount}>
                        {count} {count === 1 ? t('spending.expenseSingular') : t('spending.expensePlural')}
                      </Text>
                    </View>
                    <View style={s.barTrack}>
                      <View
                        style={[
                          s.barFill,
                          {
                            flex: fillRatio,
                            backgroundColor: cat.color + '55',
                          },
                        ]}
                      />
                      <View style={{ flex: 1 - fillRatio }} />
                    </View>
                  </View>
                  <View style={s.amountCol}>
                    <Text style={[s.amount, { color: cat.color }]}>
                      {format(total)}
                    </Text>
                    <Text style={s.pct}>{pct}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <ShareCardModal
        visible={showShare}
        onClose={() => setShowShare(false)}
        groupName={groupName ?? ''}
        grandTotal={grandTotal}
        totals={totals}
        format={format}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  iconBtn: { padding: 10, width: 44, alignItems: 'center' },
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
  totalLabel: {
    color: C.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  totalAmount: {
    color: C.white,
    fontSize: 36,
    fontWeight: '700',
    marginBottom: 4,
  },
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
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
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

const m = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: C.white,
    fontWeight: '700',
    fontSize: 17,
    marginBottom: 16,
    textAlign: 'center',
  },

  // Preview card
  card: {
    backgroundColor: C.bg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.surfaceHL,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  cardIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(23,232,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGroup: { color: C.white, fontWeight: '700', fontSize: 15 },
  cardSubtitle: { color: C.slate400, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.surfaceHL, marginVertical: 12 },
  cardTotal: { alignItems: 'center', paddingVertical: 4 },
  cardTotalLabel: {
    color: C.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardTotalAmount: { color: C.white, fontSize: 28, fontWeight: '700' },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cardEmoji: { fontSize: 14, width: 20, textAlign: 'center' },
  cardCat: { color: C.white, fontSize: 13, fontWeight: '600', width: 80 },
  cardBarWrap: { flex: 1 },
  cardBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surfaceHL,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  cardBarFill: { borderRadius: 3 },
  cardAmt: {
    fontSize: 12,
    fontWeight: '700',
    minWidth: 56,
    textAlign: 'right',
  },
  cardPct: { color: C.slate500, fontSize: 11, width: 32, textAlign: 'right' },
  cardFooter: {
    color: C.slate500,
    fontSize: 11,
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  // Share button
  shareBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
