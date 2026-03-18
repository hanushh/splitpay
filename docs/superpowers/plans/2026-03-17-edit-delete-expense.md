# Edit & Delete Expense Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any group member to edit or delete an existing expense via a detail bottom sheet on the group detail screen.

**Architecture:** Add an optional `expenseId` param to the existing `add-expense.tsx` modal to enable edit mode (pre-populated form, locked group, UPDATE instead of INSERT). Delete is handled entirely in a new detail bottom sheet in `group/[id].tsx`. A DB migration adds the required RLS UPDATE/DELETE policies.

**Tech Stack:** React Native + Expo Router, Supabase (direct table access), TypeScript strict, Jest + @testing-library/react-native

---

## Chunk 1: DB Migration + Detail Bottom Sheet

### Task 1: DB Migration — RLS UPDATE/DELETE policies

**Files:**
- Create: `supabase/migrations/20260317222508_add_expense_update_delete_policies.sql`

- [x] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260317222508_add_expense_update_delete_policies.sql

-- Allow any group member to UPDATE an expense in their group
CREATE POLICY "Group members can update expenses"
  ON expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE an expense in their group
CREATE POLICY "Group members can delete expenses"
  ON expenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Allow any group member to UPDATE expense_splits (future-proofing)
CREATE POLICY "Group members can update expense_splits"
  ON expense_splits FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );

-- Allow any group member to DELETE expense_splits (needed for edit: replace splits)
CREATE POLICY "Group members can delete expense_splits"
  ON expense_splits FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      JOIN group_members gm ON gm.group_id = e.group_id
      WHERE e.id = expense_splits.expense_id
        AND gm.user_id = auth.uid()
    )
  );
```

- [x] **Step 2: Apply migration to local Supabase**

```bash
pnpm supabase migration up
```

Expected: migration applied with no errors. If this command is unavailable, use `pnpm supabase db reset` (re-runs all migrations from scratch).

- [x] **Step 3: Commit**

```bash
git add supabase/migrations/20260317222508_add_expense_update_delete_policies.sql
git commit -m "feat: add RLS update/delete policies for expenses and expense_splits"
```

---

### Task 2: Expense detail bottom sheet in `group/[id].tsx`

**Files:**
- Modify: `app/group/[id].tsx`

- [x] **Step 1: Add state for selected expense and deleting flag**

In `GroupDetailScreen`, after the existing state declarations (around line 89), add:

```tsx
const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
const [deletingExpense, setDeletingExpense] = useState(false);
```

Also add `Alert` to the existing React Native import at the top of the file. The current import is:
```tsx
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
```
Add `Alert` to this list (keep all existing entries, add `Alert` alphabetically).

- [x] **Step 2: Wire expense card onPress to open the sheet**

Find the existing expense card `Pressable` (around line 297):
```tsx
<Pressable key={expense.expense_id} style={...}>
```

Add `onPress`:
```tsx
<Pressable
  key={expense.expense_id}
  style={({ pressed }: { pressed: boolean }) => [s.expenseCard, pressed && { opacity: 0.8 }]}
  onPress={() => setSelectedExpense(expense)}
>
```

- [x] **Step 3: Add delete handler function**
  > Note: implemented with `handleDeleteExpense` + a separate `handleEditExpense` callback (not inline in the sheet). Functionally identical to the plan.

After `handleDelete` (the group-delete handler, around line 132), add:

```tsx
const handleDeleteExpense = useCallback(() => {
  if (!selectedExpense) return;
  const name = selectedExpense.description;
  Alert.alert(
    'Delete expense?',
    `"${name}" will be permanently deleted and balances will be recalculated.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingExpense(true);
          const { error } = await supabase
            .from('expenses')
            .delete()
            .eq('id', selectedExpense.expense_id);
          if (error) {
            setDeletingExpense(false);
            Alert.alert('Error', error.message);
            return;
          }
          setSelectedExpense(null);
          setDeletingExpense(false);
          fetchGroup();
        },
      },
    ],
  );
}, [selectedExpense, fetchGroup]);
```

- [x] **Step 4: Add the detail bottom sheet modal**

Just before the closing `</KeyboardAvoidingView>` (or before the existing Settings modal), add:

```tsx
{/* ── Expense detail sheet ─────────────────────────── */}
<Modal
  visible={!!selectedExpense}
  transparent
  animationType="slide"
  onRequestClose={() => setSelectedExpense(null)}
>
  <Pressable
    style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
    onPress={() => setSelectedExpense(null)}
  />
  {selectedExpense && (
    <View style={s.expenseDetailSheet}>
      <View style={s.sheetHandle} />
      <Text style={s.sheetTitle} numberOfLines={2}>{selectedExpense.description}</Text>
      <Text style={s.sheetSubtitle}>
        {new Date(selectedExpense.created_at).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        })}
      </Text>

      <View style={s.sheetDetailRow}>
        <MaterialIcons name="payments" size={18} color={C.slate400} />
        <Text style={s.sheetDetailLabel}>Total amount</Text>
        <Text style={s.sheetDetailValue}>{format(selectedExpense.total_amount_cents)}</Text>
      </View>
      <View style={s.sheetDetailRow}>
        <MaterialIcons name="person" size={18} color={C.slate400} />
        <Text style={s.sheetDetailLabel}>Paid by</Text>
        <Text style={s.sheetDetailValue}>
          {selectedExpense.paid_by_is_user ? 'You' : selectedExpense.paid_by_name}
        </Text>
      </View>
      <View style={s.sheetDetailRow}>
        <MaterialIcons name="call-split" size={18} color={C.slate400} />
        <Text style={s.sheetDetailLabel}>Your share</Text>
        <Text style={[s.sheetDetailValue, { color: selectedExpense.paid_by_is_user ? C.primary : C.orange }]}>
          {format(selectedExpense.paid_by_is_user
            ? selectedExpense.total_amount_cents - selectedExpense.your_split_cents
            : selectedExpense.your_split_cents)}
        </Text>
      </View>
      <View style={s.sheetDetailRow}>
        <MaterialIcons name="category" size={18} color={C.slate400} />
        <Text style={s.sheetDetailLabel}>Category</Text>
        <Text style={s.sheetDetailValue}>{selectedExpense.category}</Text>
      </View>

      <View style={s.sheetActions}>
        <Pressable
          style={({ pressed }) => [s.sheetEditBtn, pressed && { opacity: 0.8 }]}
          onPress={() => {
            setSelectedExpense(null);
            router.push({
              pathname: '/add-expense',
              params: {
                expenseId: selectedExpense.expense_id,
                groupId: id,
                groupName: group?.name ?? '',
              },
            });
          }}
        >
          <MaterialIcons name="edit" size={18} color={C.primary} />
          <Text style={s.sheetEditBtnText}>Edit</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [s.sheetDeleteBtn, pressed && { opacity: 0.8 }]}
          onPress={handleDeleteExpense}
          disabled={deletingExpense}
        >
          {deletingExpense ? (
            <ActivityIndicator size="small" color="#ff5252" />
          ) : (
            <>
              <MaterialIcons name="delete-outline" size={18} color="#ff5252" />
              <Text style={s.sheetDeleteBtnText}>Delete</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  )}
</Modal>
```

- [x] **Step 5: Add styles for the detail sheet**

In the `StyleSheet.create(...)` block at the bottom of the file, add these styles. The file already has `bottomSheet` and `sheetHandle` styles from the Settings modal — add the expense-detail-specific ones:

```tsx
expenseDetailSheet: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  backgroundColor: C.surface,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  paddingTop: 12,
  paddingHorizontal: 20,
  paddingBottom: 40,
},
sheetSubtitle: { color: C.slate400, fontSize: 13, marginBottom: 20 },
sheetDetailRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: C.surfaceHL,
},
sheetDetailLabel: { flex: 1, color: C.slate400, fontSize: 14 },
sheetDetailValue: { color: C.white, fontSize: 14, fontWeight: '600' },
sheetActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
sheetEditBtn: {
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
sheetEditBtnText: { color: C.primary, fontSize: 15, fontWeight: '700' },
sheetDeleteBtn: {
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
sheetDeleteBtnText: { color: '#ff5252', fontSize: 15, fontWeight: '700' },
```

Note: `sheetHandle` and `sheetTitle` already exist in the file — do not duplicate them.

- [x] **Step 6: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add app/group/\[id\].tsx
git commit -m "feat: add expense detail sheet with edit/delete entry points"
```

---

## Chunk 2: Edit Mode in `add-expense.tsx` + Tests

### Task 3: Edit mode — data fetch and form pre-population

**Files:**
- Modify: `app/add-expense.tsx`

- [ ] **Step 1: Add `expenseId` to route params and `isEditing` flag**

Find the existing `useLocalSearchParams` call (around line 67):
```tsx
const { groupId: urlGroupId, groupName: urlGroupName } =
  useLocalSearchParams<{ groupId?: string; groupName?: string }>();
```

Replace with:
```tsx
const { groupId: urlGroupId, groupName: urlGroupName, expenseId } =
  useLocalSearchParams<{ groupId?: string; groupName?: string; expenseId?: string }>();
const isEditing = !!expenseId;
```

- [ ] **Step 2: Add `editPaidByRef` and a loading state for edit fetch**

After the existing state declarations, add:
```tsx
const editPaidByRef = useRef<string | null>(null);
const [editLoading, setEditLoading] = useState(false);
const [editError, setEditError] = useState<string | null>(null);
```

Also add `useRef` to the React import if not already present:
```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
```

- [ ] **Step 3: Add the edit-mode data fetch effect**

After the existing `useEffect` that calls `loadMembers` when `groupId` changes (around line 185–187), add:

```tsx
// In edit mode: fetch raw expense + splits and pre-populate form
useEffect(() => {
  if (!isEditing || !expenseId) return;
  setEditLoading(true);
  setEditError(null);

  (async () => {
    const [{ data: expenseRow, error: expErr }, { data: splitRows, error: splitErr }] =
      await Promise.all([
        supabase
          .from('expenses')
          .select('id, description, amount_cents, paid_by_member_id, category, receipt_url')
          .eq('id', expenseId)
          .single(),
        supabase
          .from('expense_splits')
          .select('member_id')
          .eq('expense_id', expenseId),
      ]);

    if (expErr || !expenseRow) {
      setEditError(expErr?.message ?? 'Could not load expense.');
      setEditLoading(false);
      return;
    }
    if (splitErr) {
      setEditError(splitErr.message);
      setEditLoading(false);
      return;
    }

    // Pre-populate form fields
    setDescription(expenseRow.description);
    setAmount((expenseRow.amount_cents / 100).toFixed(2));
    setReceiptUri(expenseRow.receipt_url ?? null);
    setSelectedMembers(new Set((splitRows ?? []).map((r: { member_id: string }) => r.member_id)));

    // Category: known keys stay as-is; unknown keys go to 'other' + customCategory
    const knownCategories = ['restaurant', 'train', 'hotel', 'movie', 'store', 'other'];
    if (knownCategories.includes(expenseRow.category)) {
      setDetectedCategory(expenseRow.category);
    } else {
      setDetectedCategory('other');
      setCustomCategory(expenseRow.category ?? '');
    }

    // Store paid_by_member_id for use after loadMembers finishes (race-condition safe)
    editPaidByRef.current = expenseRow.paid_by_member_id;

    setEditLoading(false);
  })();
}, [isEditing, expenseId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Override `paidBy` auto-set in `loadMembers` for edit mode**

Find the `loadMembers` function, specifically the part after `setMembers(list)` (around line 176–181):
```tsx
setMembers(list);
const me = list.find((m) => m.is_me);
if (me) {
  setPaidBy(me.id);
  setSelectedMembers(new Set(list.map((m) => m.id)));
}
```

Replace with:
```tsx
setMembers(list);
const me = list.find((m) => m.is_me);
if (isEditing && editPaidByRef.current) {
  // Edit mode: use the stored paid_by_member_id, don't reset to current user
  setPaidBy(editPaidByRef.current);
} else if (me) {
  // Create mode: default to current user as payer; select all members
  setPaidBy(me.id);
  setSelectedMembers(new Set(list.map((m) => m.id)));
}
```

- [ ] **Step 5: Run typecheck to confirm no errors so far**

```bash
pnpm typecheck
```

Expected: no errors.

---

### Task 4: Edit mode — UI changes (locked group, copy, save handler)

**Files:**
- Modify: `app/add-expense.tsx`

- [ ] **Step 1: Replace the group selector with a locked view in edit mode**

Find the group selector `Pressable` (around line 370–382):
```tsx
<Pressable
  style={...}
  onPress={() => setGroupPickerOpen(true)}
  testID="group-picker-button"
>
  ...
</Pressable>
```

Wrap it in a conditional:
```tsx
{isEditing ? (
  <View
    style={[s.groupRow, { opacity: 1 }]}
    testID="group-locked-row"
  >
    <View style={s.inputIcon}>
      <MaterialIcons name="group" size={22} color={C.primary} />
    </View>
    <Text style={s.groupRowText}>{groupName}</Text>
    <MaterialIcons name="lock-outline" size={18} color={C.slate500} />
  </View>
) : (
  <Pressable
    style={({ pressed }: { pressed: boolean }) => [s.groupRow, pressed && { opacity: 0.75 }]}
    onPress={() => setGroupPickerOpen(true)}
    testID="group-picker-button"
  >
    <View style={s.inputIcon}>
      <MaterialIcons name="group" size={22} color={groupId ? C.primary : C.slate400} />
    </View>
    <Text style={[s.groupRowText, !groupId && s.groupRowPlaceholder]}>
      {groupId ? groupName : 'Select a group (required)'}
    </Text>
    <MaterialIcons name="arrow-drop-down" size={22} color={C.slate400} />
  </Pressable>
)}
```

- [ ] **Step 2: Update header title and save button copy**

Find the header title (around line 358):
```tsx
<Text style={s.headerTitle}>Add expense</Text>
```
Replace with:
```tsx
<Text style={s.headerTitle}>{isEditing ? 'Edit expense' : 'Add expense'}</Text>
```

Find the footer save button text (around line 614):
```tsx
<Text style={s.saveBtnText}>Save Expense</Text>
```
Replace with:
```tsx
<Text style={s.saveBtnText}>{isEditing ? 'Save Changes' : 'Save Expense'}</Text>
```

- [ ] **Step 3: Show edit loading / error state**

Find the error row (around line 426):
```tsx
{error && (
  <View style={s.errorRow}>
    ...
  </View>
)}
```

Just before it, add:
```tsx
{editLoading && (
  <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
)}
{editError && (
  <View style={s.errorRow}>
    <MaterialIcons name="error-outline" size={16} color={C.orange} />
    <Text style={s.errorText}>{editError}</Text>
  </View>
)}
```

- [ ] **Step 4: Update `handleSave` for edit mode**

Find the `handleSave` function. The current save logic starts after validation (around line 289). Replace the Supabase insert block:

```tsx
// --- EXISTING (create mode only) ---
// const { data: expense, error: expErr } = await supabase
//   .from('expenses')
//   .insert({ ... })
//   .select('id')
//   .single();
```

First, **remove** the existing `finalCategory` computation and everything through `router.back()` at the end of `handleSave` (lines 285–335 in the original file):

```tsx
// REMOVE these lines (lines 285–335 in the original file):
const finalCategory = detectedCategory === 'other' && customCategory.trim()
  ? customCategory.trim().toLowerCase()
  : detectedCategory;

// Insert expense
const { data: expense, error: expErr } = await supabase
  .from('expenses')
  .insert({ ... })
  ...

// ... all the way through ...
router.back();
```

**Replace** the entire removed block with:

```tsx
const finalCategory = detectedCategory === 'other' && customCategory.trim()
  ? customCategory.trim().toLowerCase()
  : detectedCategory;

if (isEditing && expenseId) {
  // ── Edit mode: UPDATE expense, DELETE old splits, INSERT new splits ──
  const { error: updateErr } = await supabase
    .from('expenses')
    .update({
      description: description.trim(),
      amount_cents: amtCents,
      paid_by_member_id: paidBy,
      category: finalCategory,
      receipt_url: receiptUri,
    })
    .eq('id', expenseId);

  if (updateErr) { setError(updateErr.message); setSaving(false); return; }

  const { error: deleteErr } = await supabase
    .from('expense_splits')
    .delete()
    .eq('expense_id', expenseId);

  if (deleteErr) { setError(deleteErr.message); setSaving(false); return; }

  const splitIds = [...selectedMembers];
  const perPerson = Math.round(amtCents / splitIds.length);
  const splits = splitIds.map((memberId, i) => ({
    expense_id: expenseId,
    member_id: memberId,
    amount_cents:
      i === splitIds.length - 1
        ? amtCents - perPerson * (splitIds.length - 1)
        : perPerson,
  }));

  const { error: splitErr } = await supabase.from('expense_splits').insert(splits);
  if (splitErr) { setError(splitErr.message); setSaving(false); return; }

  setSaving(false);
  router.back();
  return;
}

// ── Create mode: INSERT expense + splits ──
// Insert expense
const { data: expense, error: expErr } = await supabase
  .from('expenses')
  .insert({
    group_id: groupId,
    description: description.trim(),
    amount_cents: amtCents,
    paid_by_member_id: paidBy,
    category: finalCategory,
    ...(receiptUri ? { receipt_url: receiptUri } : {}),
  })
  .select('id')
  .single();

if (expErr || !expense) {
  setError(expErr?.message ?? 'Failed to save expense');
  setSaving(false);
  return;
}

// Compute equal splits (last member absorbs rounding difference)
const splitIds = [...selectedMembers];
const perPerson = Math.round(amtCents / splitIds.length);
const splits = splitIds.map((memberId, i) => ({
  expense_id: expense.id,
  member_id: memberId,
  amount_cents: i === splitIds.length - 1
    ? amtCents - perPerson * (splitIds.length - 1)
    : perPerson,
}));

const { error: splitErr } = await supabase.from('expense_splits').insert(splits);
if (splitErr) {
  setError(splitErr.message ?? 'Expense saved but splits failed');
  setSaving(false);
  return;
}

setSaving(false);
// Fire-and-forget category reinforcement (create mode only)
if (detectedCategory !== 'other') {
  reinforceMapping(description, detectedCategory);
} else if (customCategory.trim()) {
  saveMapping(description, customCategory.trim().toLowerCase());
}
router.back();
```

> **Note:** Category reinforcement (`reinforceMapping`/`saveMapping`) only runs in create mode. Edit mode returns early before reaching this block — this is intentional.

- [ ] **Step 5: Run typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/add-expense.tsx
git commit -m "feat: add edit mode to add-expense screen (pre-populated form, locked group, update save)"
```

---

### Task 5: Tests

**Files:**
- Create: `__tests__/screens/add-expense-edit.test.tsx`
- Create: `__tests__/screens/group-detail-delete.test.tsx`

> **Pattern reference:** See `__tests__/hooks/use-groups.test.tsx` for the Supabase mock pattern. Tests use `jest.mock('@/lib/supabase')` with a chainable builder mock.

- [ ] **Step 1: Write tests for edit mode in add-expense**

Create `__tests__/screens/add-expense-edit.test.tsx`:

```tsx
import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import AddExpenseScreen from '@/app/add-expense';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/context/currency', () => ({
  useCurrency: () => ({ currency: { code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' } }),
  CURRENCIES: [{ code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' }],
}));
jest.mock('@/hooks/use-category-cache', () => ({
  useCategoryCache: () => ({ detect: () => 'other', saveMapping: jest.fn(), reinforceMapping: jest.fn() }),
}));

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  router: mockRouter,
  useLocalSearchParams: () => ({
    groupId: 'group-1',
    groupName: 'Bali Trip',
    expenseId: 'expense-1',
  }),
}));

const mockExpenseRow = {
  id: 'expense-1',
  description: 'Dinner at Locavore',
  amount_cents: 12000,
  paid_by_member_id: 'member-2',
  category: 'restaurant',
  receipt_url: null,
};

const mockSplitRows = [
  { member_id: 'member-1' },
  { member_id: 'member-2' },
];

const mockMembers = [
  { id: 'member-1', display_name: null, avatar_url: null, user_id: 'user-1' },
  { id: 'member-2', display_name: 'Alex', avatar_url: null, user_id: 'user-2' },
];

// Track calls to each table for save-path assertions
let updateMock: jest.Mock;
let splitsDeleteMock: jest.Mock;
let splitsInsertMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  splitsDeleteMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  splitsInsertMock = jest.fn().mockResolvedValue({ error: null });

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'group_members') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockMembers, error: null }),
      };
    }
    if (table === 'expenses') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockExpenseRow, error: null }),
        update: updateMock,
      };
    }
    if (table === 'expense_splits') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockSplitRows, error: null }),
        delete: splitsDeleteMock,
        insert: splitsInsertMock,
      };
    }
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) };
  });
});

test('edit mode: description pre-populated from fetched expense', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
  });
});

test('edit mode: amount pre-populated as display string', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('amount-input').props.value).toBe('120.00');
  });
});

test('edit mode: group selector is locked (no testID group-picker-button)', async () => {
  const { queryByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(queryByTestId('group-picker-button')).toBeNull();
    expect(queryByTestId('group-locked-row')).not.toBeNull();
  });
});

test('edit mode: header shows "Edit expense"', async () => {
  const { getByText } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByText('Edit expense')).toBeTruthy();
  });
});

test('edit mode: paidBy is set from fetched paid_by_member_id (member-2), not defaulted to current user (member-1)', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  // Wait for members and expense data to load
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
  });
  // The paid-by section should show Alex (member-2), not You (member-1/current user)
  const paidBySection = getByTestId('paid-by-section');
  expect(paidBySection).toBeTruthy();
  // The compact row value text should show 'Alex', not 'You'
  // (Implementation note: the compactRowValueText inside paid-by-section shows the payer name)
  expect(paidBySection).toHaveTextContent('Alex');
});

test('edit mode: save calls UPDATE then DELETE splits then INSERT splits', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
  });
  fireEvent.press(getByTestId('save-expense-button'));
  await waitFor(() => {
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(splitsDeleteMock).toHaveBeenCalledTimes(1);
    expect(splitsInsertMock).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they pass**

```bash
pnpm test __tests__/screens/add-expense-edit.test.tsx --no-coverage
```

Expected: 6 tests pass.

- [ ] **Step 3: Write tests for delete flow in group detail**

Create `__tests__/screens/group-detail-delete.test.tsx`:

```tsx
import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/group/[id]';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/context/currency', () => ({
  useCurrency: () => ({ format: (c: number) => `$${(c / 100).toFixed(2)}` }),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'group-1' }),
}));

const mockGroup = {
  id: 'group-1', name: 'Bali Trip', description: null, image_url: null, created_by: 'user-1',
};
const mockExpenses = [
  {
    expense_id: 'exp-1',
    description: 'Dinner at Locavore',
    total_amount_cents: 12000,
    category: 'restaurant',
    created_at: '2026-03-15T12:00:00Z',
    paid_by_name: 'You',
    paid_by_is_user: true,
    your_split_cents: 6000,
  },
];

let deleteMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
  deleteMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });

  (supabase.from as jest.Mock).mockImplementation((_table: string) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { balance_cents: 6000 }, error: null }),
    single: jest.fn().mockResolvedValue({ data: mockGroup, error: null }),
    delete: deleteMock,
  }));
  // Use mockResolvedValue on the already-mocked rpc function (don't reassign)
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: mockExpenses, error: null });
});

async function openDetailSheet(getByText: ReturnType<typeof render>['getByText']) {
  await waitFor(() => getByText('Dinner at Locavore'));
  fireEvent.press(getByText('Dinner at Locavore'));
  await waitFor(() => getByText('Delete'));
}

test('tapping an expense card opens the detail sheet', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  expect(getByText('Edit')).toBeTruthy();
  expect(getByText('Delete')).toBeTruthy();
});

test('tapping Delete shows confirmation Alert with expense name', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));
  expect(Alert.alert).toHaveBeenCalledWith(
    'Delete expense?',
    expect.stringContaining('Dinner at Locavore'),
    expect.any(Array),
  );
});

test('confirming delete calls supabase delete and then re-fetches group', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));

  // Simulate the user pressing the destructive "Delete" button in the Alert
  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'Delete');
  await deleteButton!.onPress!();

  await waitFor(() => {
    expect(deleteMock).toHaveBeenCalledTimes(1);
    // fetchGroup re-fires supabase.rpc — confirm it was called more than once (initial load + refetch)
    expect((supabase.rpc as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });
});

test('delete error shows Alert and does not close the sheet', async () => {
  // Override delete to return an error
  deleteMock.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'Permission denied' } }) });

  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));

  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'Delete');
  await deleteButton!.onPress!();

  await waitFor(() => {
    // A second Alert should have been shown with the error message
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Permission denied');
    // The sheet should still be visible (Edit/Delete buttons still rendered)
    expect(getByText('Edit')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```bash
pnpm test __tests__/screens/group-detail-delete.test.tsx --no-coverage
```

Expected: 4 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
pnpm test --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Final lint + typecheck**

```bash
pnpm lint && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add __tests__/screens/add-expense-edit.test.tsx __tests__/screens/group-detail-delete.test.tsx
git commit -m "test: add unit tests for expense edit mode and delete confirmation"
```
