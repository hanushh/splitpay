# Expense Detail Sheet Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal expense bottom sheet with a rich Splitwise-style detail view showing a category icon header, large total hero, and per-member split breakdown with proportion bars loaded lazily on tap.

**Architecture:** A new purely-presentational `ExpenseDetailSheet` component receives all data via props and owns no state. `GroupDetailScreen` gains two new state fields (`splits`, `splitsLoading`) and a `useEffect` that fires a point-lookup query against `expense_splits` when an expense is tapped, joining results in-memory against the already-loaded `members` array.

**Tech Stack:** React Native `StyleSheet`, `Modal`, `Animated` (pulse skeleton), `useSafeAreaInsets`, Supabase JS client, Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-03-19-expense-detail-sheet-redesign.md`

---

## File Map

| File                                               | Action     | Responsibility                                                                                         |
| -------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| `components/ExpenseDetailSheet.tsx`                | **Create** | Purely-presentational sheet: header, hero, skeleton/splits, actions                                    |
| `app/group/[id].tsx`                               | **Modify** | Add `splits`/`splitsLoading` state + `useEffect`; replace inline sheet JSX with `<ExpenseDetailSheet>` |
| `__tests__/components/ExpenseDetailSheet.test.tsx` | **Create** | Unit tests for the new component                                                                       |
| `__tests__/screens/group-detail-delete.test.tsx`   | **Modify** | Make `supabase.from` mock table-aware so `expense_splits` resolves                                     |

---

## Chunk 1: ExpenseDetailSheet component + tests

### Task 1: Create the failing tests for ExpenseDetailSheet

**Files:**

- Create: `__tests__/components/ExpenseDetailSheet.test.tsx`

- [ ] **Step 1.1: Create the test file**

```tsx
// __tests__/components/ExpenseDetailSheet.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ExpenseDetailSheet from '@/components/ExpenseDetailSheet';

// ── shared fixtures ──────────────────────────────────────────────────────────

const mockExpense = {
  expense_id: 'exp-1',
  description: 'Dinner at Locavore',
  total_amount_cents: 12000,
  category: 'restaurant',
  created_at: '2026-03-15T12:00:00Z',
  paid_by_name: 'You',
  paid_by_is_user: true,
  your_split_cents: 6000,
};

const mockMembers = [
  { id: 'mem-1', display_name: 'You', avatar_url: null, user_id: 'user-1' },
  { id: 'mem-2', display_name: 'Arjun', avatar_url: null, user_id: 'user-2' },
];

const mockSplits = [
  { member_id: 'mem-1', amount_cents: 6000 },
  { member_id: 'mem-2', amount_cents: 6000 },
];

const baseProps = {
  expense: mockExpense,
  splits: mockSplits,
  splitsLoading: false,
  deletingExpense: false,
  members: mockMembers,
  currentUserId: 'user-1',
  isArchived: false,
  onClose: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  format: (c: number) => `$${(c / 100).toFixed(2)}`,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

// ── tests ────────────────────────────────────────────────────────────────────

test('renders nothing when expense is null', () => {
  const { queryByText } = render(
    <ExpenseDetailSheet {...baseProps} expense={null} />,
  );
  expect(queryByText('Dinner at Locavore')).toBeNull();
});

test('renders expense title, total, and paid-by name', () => {
  const { getByText } = render(<ExpenseDetailSheet {...baseProps} />);
  expect(getByText('Dinner at Locavore')).toBeTruthy();
  expect(getByText('$120.00')).toBeTruthy();
  expect(getByText('You')).toBeTruthy();
});

test('renders skeleton rows when splitsLoading is true', () => {
  const { getAllByTestId } = render(
    <ExpenseDetailSheet {...baseProps} splits={[]} splitsLoading={true} />,
  );
  expect(getAllByTestId('split-skeleton').length).toBe(3);
});

test('renders member rows with correct amounts when splits are provided', () => {
  const { getByText, getAllByText } = render(
    <ExpenseDetailSheet {...baseProps} />,
  );
  expect(getByText('Arjun')).toBeTruthy();
  // Both members have $60.00
  expect(getAllByText('$60.00').length).toBeGreaterThanOrEqual(1);
});

test('hides Edit and Delete actions when isArchived is true', () => {
  const { queryByText } = render(
    <ExpenseDetailSheet {...baseProps} isArchived={true} />,
  );
  expect(queryByText('Edit')).toBeNull();
  expect(queryByText('Delete')).toBeNull();
});

test('shows ActivityIndicator on Delete when deletingExpense is true', () => {
  const { queryByText, getByTestId } = render(
    <ExpenseDetailSheet {...baseProps} deletingExpense={true} />,
  );
  expect(queryByText('Delete')).toBeNull();
  expect(getByTestId('delete-loading')).toBeTruthy();
});

test('calls onEdit when Edit is pressed', () => {
  const onEdit = jest.fn();
  const { getByText } = render(
    <ExpenseDetailSheet {...baseProps} onEdit={onEdit} />,
  );
  fireEvent.press(getByText('Edit'));
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('calls onDelete when Delete is pressed', () => {
  const onDelete = jest.fn();
  const { getByText } = render(
    <ExpenseDetailSheet {...baseProps} onDelete={onDelete} />,
  );
  fireEvent.press(getByText('Delete'));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('shows "Unknown" for a split whose member_id is not in members array', () => {
  const splitsWithUnknown = [
    { member_id: 'mem-1', amount_cents: 6000 },
    { member_id: 'mem-999', amount_cents: 6000 }, // not in mockMembers
  ];
  const { getByText } = render(
    <ExpenseDetailSheet {...baseProps} splits={splitsWithUnknown} />,
  );
  expect(getByText('Unknown')).toBeTruthy();
});
```

- [ ] **Step 1.2: Run tests — confirm they all fail (component not yet created)**

```bash
pnpm test __tests__/components/ExpenseDetailSheet.test.tsx --no-coverage
```

Expected: All tests fail with "Cannot find module '@/components/ExpenseDetailSheet'".

---

### Task 2: Create ExpenseDetailSheet component

**Files:**

- Create: `components/ExpenseDetailSheet.tsx`

- [ ] **Step 2.1: Create the component**

```tsx
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
  primary: '#17e86b',
  orange: '#f97316',
  danger: '#ff5252',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

// ── category icon map (matches app/group/[id].tsx CATEGORY_ICONS) ─────────────
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
};

// ── skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.8,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 600,
          useNativeDriver: true,
        }),
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
  const categoryLabel =
    expense.category.charAt(0).toUpperCase() + expense.category.slice(1);
  const dateLabel = new Date(expense.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
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
    return (aResolved.name ?? 'Unknown').localeCompare(
      bResolved.name ?? 'Unknown',
    );
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
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: 'rgba(0,0,0,0.6)' },
        ]}
        onPress={onClose}
      />

      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.handle} />

        {/* ① Header */}
        <View style={s.header}>
          <View style={[s.catIcon, { backgroundColor: catMeta.bg }]}>
            <MaterialIcons
              name={catMeta.icon as any}
              size={22}
              color={catMeta.color}
            />
          </View>
          <View style={s.headerText}>
            <Text style={s.title} numberOfLines={2}>
              {expense.description}
            </Text>
            <Text style={s.subtitle}>
              {dateLabel} · {categoryLabel}
            </Text>
          </View>
        </View>

        {/* ② Hero */}
        <View style={s.hero}>
          <Text style={s.heroAmount}>{format(expense.total_amount_cents)}</Text>
          <View style={s.payerRow}>
            <View
              style={[
                s.payerAvatar,
                {
                  backgroundColor: expense.paid_by_is_user
                    ? 'rgba(23,232,107,0.15)'
                    : 'rgba(249,115,22,0.15)',
                },
              ]}
            >
              <Text
                style={[
                  s.payerAvatarText,
                  { color: expense.paid_by_is_user ? C.primary : C.orange },
                ]}
              >
                {(expense.paid_by_is_user
                  ? 'Y'
                  : expense.paid_by_name.charAt(0)
                ).toUpperCase()}
              </Text>
            </View>
            <Text style={s.payerLabel}>Paid by </Text>
            <Text style={s.payerName}>
              {expense.paid_by_is_user ? 'You' : expense.paid_by_name}
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
              const { name, initials, isCurrentUser } = resolveMember(
                split.member_id,
              );
              const isPayer = expense.paid_by_is_user
                ? isCurrentUser
                : name === expense.paid_by_name;
              const barWidth =
                expense.total_amount_cents > 0
                  ? (split.amount_cents / expense.total_amount_cents) * 100
                  : 0;
              const amountColor = isCurrentUser ? C.primary : C.orange;
              const avatarBg = isCurrentUser
                ? 'rgba(23,232,107,0.15)'
                : C.surfaceHL;
              const avatarColor = isCurrentUser ? C.primary : C.slate400;

              return (
                <View key={split.member_id} style={s.splitRow}>
                  <View style={s.splitTop}>
                    <View
                      style={[s.splitAvatar, { backgroundColor: avatarBg }]}
                    >
                      <Text style={[s.splitAvatarText, { color: avatarColor }]}>
                        {initials}
                      </Text>
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
                    <View
                      style={[
                        s.barFill,
                        {
                          width: `${barWidth}%` as any,
                          backgroundColor: amountColor,
                        },
                      ]}
                    />
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
              style={({ pressed }) => [s.editBtn, pressed && { opacity: 0.8 }]}
              onPress={onEdit}
            >
              <MaterialIcons name="edit" size={18} color={C.primary} />
              <Text style={s.editBtnText}>Edit</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.deleteBtn,
                pressed && { opacity: 0.8 },
              ]}
              onPress={onDelete}
              disabled={deletingExpense}
            >
              {deletingExpense ? (
                <ActivityIndicator
                  testID="delete-loading"
                  size="small"
                  color={C.danger}
                />
              ) : (
                <>
                  <MaterialIcons
                    name="delete-outline"
                    size={18}
                    color={C.danger}
                  />
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
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHL,
    alignSelf: 'center',
    marginBottom: 12,
  },
  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
  },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: C.white,
    marginBottom: 2,
    lineHeight: 20,
  },
  subtitle: { fontSize: 12, color: C.slate400 },
  // hero
  hero: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceHL,
    backgroundColor: C.bg,
  },
  heroAmount: {
    fontSize: 30,
    fontWeight: '800',
    color: C.white,
    marginBottom: 8,
  },
  payerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerAvatarText: { fontSize: 11, fontWeight: '700' },
  payerLabel: { fontSize: 13, color: C.slate400 },
  payerName: { fontSize: 13, color: C.white, fontWeight: '600' },
  // splits
  splitsSection: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  splitsLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: C.slate500,
    marginBottom: 12,
  },
  splitRow: { marginBottom: 12 },
  splitTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  splitAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitAvatarText: { fontSize: 12, fontWeight: '700' },
  splitName: { flex: 1, fontSize: 13, color: C.white },
  paidBadge: {
    backgroundColor: 'rgba(23,232,107,0.15)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  paidBadgeText: { fontSize: 10, color: C.primary, fontWeight: '600' },
  splitAmount: { fontSize: 13, fontWeight: '700' },
  barTrack: {
    height: 3,
    backgroundColor: C.surfaceHL,
    borderRadius: 2,
    marginLeft: 36,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  // skeleton
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  skeletonCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.surfaceHL,
  },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: C.surfaceHL },
  // actions
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.surfaceHL,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: 'rgba(23,232,107,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(23,232,107,0.3)',
  },
  editBtnText: { color: C.primary, fontSize: 15, fontWeight: '700' },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,82,82,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,82,82,0.3)',
  },
  deleteBtnText: { color: C.danger, fontSize: 15, fontWeight: '700' },
});
```

- [ ] **Step 2.2: Run the component tests — confirm they pass**

```bash
pnpm test __tests__/components/ExpenseDetailSheet.test.tsx --no-coverage
```

Expected: All 9 tests pass.

- [ ] **Step 2.3: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 2.4: Commit**

```bash
git add components/ExpenseDetailSheet.tsx __tests__/components/ExpenseDetailSheet.test.tsx
git commit -m "$(cat <<'EOF'
feat: add ExpenseDetailSheet component with split breakdown

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Wire ExpenseDetailSheet into GroupDetailScreen

### Task 3: Update group-detail-delete tests first (TDD — update the test harness before touching the screen)

**Files:**

- Modify: `__tests__/screens/group-detail-delete.test.tsx:37-51`

The `supabase.from` mock must become table-aware so the new `expense_splits` query resolves without breaking the existing `.single()` / `.maybeSingle()` chains used by other tables.

- [ ] **Step 3.1: Update the `beforeEach` mock in `group-detail-delete.test.tsx`**

Replace the existing `supabase.from` mock block (lines 43–48) with:

```ts
(supabase.from as jest.Mock).mockImplementation((table: string) => {
  if (table === 'expense_splits') {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
  }
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: { balance_cents: 6000 }, error: null }),
    single: jest.fn().mockResolvedValue({ data: mockGroup, error: null }),
  };
});
```

- [ ] **Step 3.2: Run the existing delete tests — they must still pass unchanged**

```bash
pnpm test __tests__/screens/group-detail-delete.test.tsx --no-coverage
```

Expected: 4 tests pass (mock update is backward-compatible because `expense_splits` resolution doesn't affect the existing test assertions).

---

### Task 4: Wire ExpenseDetailSheet into GroupDetailScreen

**Files:**

- Modify: `app/group/[id].tsx`

- [ ] **Step 4.1: Add the `ExpenseSplit` interface and two new state fields**

At the top of `app/group/[id].tsx`, after the existing `Expense` interface (after line 43), add:

```ts
interface ExpenseSplit {
  member_id: string; // matches GroupMember.id
  amount_cents: number;
}
```

Inside `GroupDetailScreen`, after line 101 (`const [members, setMembers] = useState<GroupMember[]>([])`), add:

```ts
const [splits, setSplits] = useState<ExpenseSplit[]>([]);
const [splitsLoading, setSplitsLoading] = useState(false);
```

- [ ] **Step 4.2a: Add `useEffect` to the React import (line 3)**

Change line 3 from:

```ts
import React, { useCallback, useState } from 'react';
```

to:

```ts
import React, { useCallback, useEffect, useState } from 'react';
```

- [ ] **Step 4.2b: Add the `useEffect` to fetch splits when an expense is tapped**

After the `useFocusEffect` line (line 165), add:

```ts
// Fetch per-member splits when an expense is selected
useEffect(() => {
  if (!selectedExpense) {
    setSplits([]);
    setSplitsLoading(false);
    return;
  }
  let cancelled = false;
  setSplitsLoading(true);
  setSplits([]);

  const fetchSplits = async () => {
    const { data, error } = await supabase
      .from('expense_splits')
      .select('member_id, amount_cents')
      .eq('expense_id', selectedExpense.expense_id);
    if (!cancelled) {
      if (!error) setSplits((data as ExpenseSplit[]) ?? []);
      setSplitsLoading(false);
    }
  };

  fetchSplits();
  return () => {
    cancelled = true;
  };
}, [selectedExpense?.expense_id]);
```

- [ ] **Step 4.3: Add the ExpenseDetailSheet import**

At the top of `app/group/[id].tsx`, after the existing imports, add:

```ts
import ExpenseDetailSheet from '@/components/ExpenseDetailSheet';
```

- [ ] **Step 4.4: Replace the inline expense detail Modal with `<ExpenseDetailSheet>`**

Remove the entire inline expense detail `Modal` block (lines 482–555):

```tsx
{
  /* ── Expense detail sheet ─────────────────────────── */
}
<Modal
  visible={!!selectedExpense}
  transparent
  animationType="slide"
  onRequestClose={() => setSelectedExpense(null)}
>
  ...
</Modal>;
```

Replace it with:

```tsx
{
  /* ── Expense detail sheet ─────────────────────────── */
}
{
  selectedExpense && (
    <ExpenseDetailSheet
      expense={selectedExpense}
      splits={splits}
      splitsLoading={splitsLoading}
      deletingExpense={deletingExpense}
      members={members}
      currentUserId={user?.id ?? ''}
      isArchived={group?.archived ?? false}
      onClose={() => setSelectedExpense(null)}
      onEdit={handleEditExpense}
      onDelete={handleDeleteExpense}
      format={format}
    />
  );
}
```

- [ ] **Step 4.5: Remove now-unused styles from `[id].tsx`**

The following style keys in the `StyleSheet.create` block at the bottom of `[id].tsx` are no longer used after the sheet was extracted. Remove them:

- `expenseDetailSheet`
- `sheetSubtitle`
- `sheetDetailRow`
- `sheetDetailLabel`
- `sheetDetailValue`
- `sheetActions`
- `sheetEditBtn`
- `sheetEditBtnText`
- `sheetDeleteBtn`
- `sheetDeleteBtnText`

> Note: `sheetHandle`, `sheetTitle`, `bottomSheet`, `settingsModalContainer` are still used by the Settings bottom sheet — do NOT remove those.

- [ ] **Step 4.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4.7: Run the full test suite**

```bash
pnpm test --no-coverage
```

Expected: All 143+ tests pass (9 new from ExpenseDetailSheet, all existing tests still green).

- [ ] **Step 4.8: Run lint**

```bash
pnpm lint
```

Expected: No errors.

- [ ] **Step 4.9: Commit**

```bash
git add app/group/[id].tsx __tests__/screens/group-detail-delete.test.tsx
git commit -m "$(cat <<'EOF'
feat: wire ExpenseDetailSheet into GroupDetailScreen with lazy split fetch

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
