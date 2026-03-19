// components/ExpenseDetailSheet.tsx
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── types (mirrored from app/group/[id].tsx — keep in sync) ──────────────────
export interface Expense {
  expense_id: string;
  description: string;
  total_amount_cents: number;
  category: string;
  created_at: string;
  paid_by_name: string;
  paid_by_is_user: boolean;
  your_split_cents: number;
}

export interface ExpenseSplit {
  member_id: string; // matches GroupMember.id (group_members.id PK)
  amount_cents: number;
}

export interface GroupMember {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  user_id: string | null;
}

export interface ExpenseDetailSheetProps {
  expense: Expense | null;
  splits: ExpenseSplit[];
  splitsLoading: boolean;
  deletingExpense: boolean;
  members: GroupMember[];
  currentUserId: string;
  isArchived: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  format: (cents: number) => string;
}

// ── TypeScript notes ──────────────────────────────────────────────────────────
// Two `as any` casts are intentional pragmatic exceptions (same pattern as [id].tsx):
//   1. `name={catMeta.icon as any}` — MaterialIcons name prop is a large union; runtime is safe.
//   2. `{ width: \`${barWidth}%\` as any }` — RN DimensionValue doesn't accept template-literal
//      percentage strings without a cast; this is a known RN TS limitation.

// ── colour palette (matches app/group/[id].tsx) ───────────────────────────────
const C = {
  primary:   '#17e86b',
  orange:    '#f97316',
  danger:    '#ff5252',
  bg:        '#112117',
  surface:   '#1a3324',
  surfaceHL: '#244732',
  slate400:  '#94a3b8',
  slate500:  '#64748b',
  white:     '#ffffff',
};

// ── category icon map (matches app/group/[id].tsx CATEGORY_ICONS) ─────────────
const CATEGORY_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  restaurant: { icon: 'restaurant',              bg: 'rgba(249,115,22,0.15)',  color: '#f97316' },
  hotel:      { icon: 'hotel',                   bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  train:      { icon: 'train',                   bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
  store:      { icon: 'local-convenience-store', bg: 'rgba(234,179,8,0.15)',  color: '#eab308' },
  receipt:    { icon: 'receipt-long',            bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
};

// ── skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View testID="split-skeleton" style={[s.skeletonRow, { opacity }]}>
      <View style={s.skeletonCircle} />
      <View style={[s.skeletonLine, { flex: 1 }]} />
      <View style={[s.skeletonLine, { width: 48 }]} />
    </Animated.View>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function ExpenseDetailSheet({
  expense,
  splits,
  splitsLoading,
  deletingExpense,
  members,
  currentUserId,
  isArchived,
  onClose,
  onEdit,
  onDelete,
  format,
}: ExpenseDetailSheetProps) {
  const insets = useSafeAreaInsets();

  if (!expense) return null;

  const catMeta = CATEGORY_ICONS[expense.category] ?? CATEGORY_ICONS.receipt;
  const categoryLabel = expense.category.charAt(0).toUpperCase() + expense.category.slice(1);
  const dateLabel = new Date(expense.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  // ── resolve member name/initials helper ──────────────────────────────────
  function resolveMember(memberId: string) {
    const m = members.find((mem) => mem.id === memberId);
    const name = m?.display_name ?? 'Unknown';
    const initials = name.charAt(0).toUpperCase();
    const isCurrentUser = m?.user_id === currentUserId;
    return { name, initials, isCurrentUser };
  }

  // ── sort splits: current user first, then alphabetically ────────────────
  const sortedSplits = [...splits].sort((a, b) => {
    const aResolved = resolveMember(a.member_id);
    const bResolved = resolveMember(b.member_id);
    if (aResolved.isCurrentUser) return -1;
    if (bResolved.isCurrentUser) return 1;
    return (aResolved.name ?? 'Unknown').localeCompare(bResolved.name ?? 'Unknown');
  });

  return (
    <Modal
      visible={true}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable
        style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
        onPress={onClose}
      />

      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.handle} />

        {/* ① Header */}
        <View style={s.header}>
          <View style={[s.catIcon, { backgroundColor: catMeta.bg }]}>
            <MaterialIcons name={catMeta.icon as any} size={22} color={catMeta.color} />
          </View>
          <View style={s.headerText}>
            <Text style={s.title} numberOfLines={2}>{expense.description}</Text>
            <Text style={s.subtitle}>{dateLabel} · {categoryLabel}</Text>
          </View>
        </View>

        {/* ② Hero */}
        <View style={s.hero}>
          <Text style={s.heroAmount}>{format(expense.total_amount_cents)}</Text>
          <View style={s.payerRow}>
            <View style={[
              s.payerAvatar,
              { backgroundColor: expense.paid_by_is_user ? 'rgba(23,232,107,0.15)' : 'rgba(249,115,22,0.15)' },
            ]}>
              <Text style={[
                s.payerAvatarText,
                { color: expense.paid_by_is_user ? C.primary : C.orange },
              ]}>
                {(expense.paid_by_is_user ? 'Y' : expense.paid_by_name.charAt(0)).toUpperCase()}
              </Text>
            </View>
            <Text style={s.payerLabel}>
              {`Paid by ${expense.paid_by_is_user ? 'You' : expense.paid_by_name}`}
            </Text>
          </View>
        </View>

        {/* ③ Split breakdown */}
        <View style={s.splitsSection}>
          <Text style={s.splitsLabel}>Split between</Text>

          {splitsLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            sortedSplits.map((split) => {
              const { name, initials, isCurrentUser } = resolveMember(split.member_id);
              const isPayer = expense.paid_by_is_user
                ? isCurrentUser
                : name === expense.paid_by_name;
              const barWidth = expense.total_amount_cents > 0
                ? (split.amount_cents / expense.total_amount_cents) * 100
                : 0;
              const amountColor = isCurrentUser ? C.primary : C.orange;
              const avatarBg = isCurrentUser ? 'rgba(23,232,107,0.15)' : C.surfaceHL;
              const avatarColor = isCurrentUser ? C.primary : C.slate400;

              return (
                <View key={split.member_id} style={s.splitRow}>
                  <View style={s.splitTop}>
                    <View style={[s.splitAvatar, { backgroundColor: avatarBg }]}>
                      <Text style={[s.splitAvatarText, { color: avatarColor }]}>{initials}</Text>
                    </View>
                    <Text style={s.splitName}>{name}</Text>
                    {isPayer && (
                      <View style={s.paidBadge}>
                        <Text style={s.paidBadgeText}>paid</Text>
                      </View>
                    )}
                    <Text style={[s.splitAmount, { color: amountColor }]}>
                      {format(split.amount_cents)}
                    </Text>
                  </View>
                  <View style={s.barTrack}>
                    <View style={[s.barFill, { width: `${barWidth}%` as any, backgroundColor: amountColor }]} />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ④ Actions — hidden when archived */}
        {!isArchived && (
          <View style={s.actions}>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [s.editBtn, pressed && { opacity: 0.8 }]}
              onPress={onEdit}
            >
              <MaterialIcons name="edit" size={18} color={C.primary} />
              <Text style={s.editBtnText}>Edit</Text>
            </Pressable>
            <Pressable
              style={({ pressed }: { pressed: boolean }) => [s.deleteBtn, pressed && { opacity: 0.8 }]}
              onPress={onDelete}
              disabled={deletingExpense}
            >
              {deletingExpense ? (
                <ActivityIndicator testID="delete-loading" size="small" color={C.danger} />
              ) : (
                <>
                  <MaterialIcons name="delete-outline" size={18} color={C.danger} />
                  <Text style={s.deleteBtnText}>Delete</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 12,
  },
  // header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.surfaceHL,
  },
  catIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 2, lineHeight: 20 },
  subtitle: { fontSize: 12, color: C.slate400 },
  // hero
  hero: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.surfaceHL,
    backgroundColor: C.bg,
  },
  heroAmount: { fontSize: 30, fontWeight: '800', color: C.white, marginBottom: 8 },
  payerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payerAvatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  payerAvatarText: { fontSize: 11, fontWeight: '700' },
  payerLabel: { fontSize: 13, color: C.slate400 },
  payerName:  { fontSize: 13, color: C.white, fontWeight: '600' },
  // splits
  splitsSection: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  splitsLabel: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    color: C.slate500, marginBottom: 12,
  },
  splitRow: { marginBottom: 12 },
  splitTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  splitAvatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  splitAvatarText: { fontSize: 12, fontWeight: '700' },
  splitName: { flex: 1, fontSize: 13, color: C.white },
  paidBadge: {
    backgroundColor: 'rgba(23,232,107,0.15)',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  paidBadgeText: { fontSize: 10, color: C.primary, fontWeight: '600' },
  splitAmount: { fontSize: 13, fontWeight: '700' },
  barTrack: {
    height: 3, backgroundColor: C.surfaceHL, borderRadius: 2,
    marginLeft: 36, overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  // skeleton
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  skeletonCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceHL },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: C.surfaceHL },
  // actions
  actions: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.surfaceHL,
  },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14,
    backgroundColor: 'rgba(23,232,107,0.1)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(23,232,107,0.3)',
  },
  editBtnText: { color: C.primary, fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14,
    backgroundColor: 'rgba(255,82,82,0.08)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,82,82,0.3)',
  },
  deleteBtnText: { color: C.danger, fontSize: 15, fontWeight: '700' },
});
