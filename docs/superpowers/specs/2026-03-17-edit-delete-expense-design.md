# Edit & Delete Expense — Design Spec

**Date:** 2026-03-17
**Branch:** feat/friends-tab
**Status:** Approved

---

## Overview

Allow any group member to edit or delete an existing expense. The entry point is a detail bottom sheet opened by tapping an expense card in the group detail screen. Edit reuses the existing `add-expense.tsx` modal in a new "edit mode". Delete is handled entirely within the detail sheet with a confirmation dialog.

---

## User Flow

1. User taps an expense card in `app/group/[id].tsx`
2. A bottom sheet slides up showing expense metadata (amount, paid by, split, category) with **Edit** and **Delete** buttons
3. **Edit path:** tapping Edit navigates to `/add-expense` with `expenseId` + `groupId` + `groupName` params → pre-populated form, group locked → user edits → taps "Save Changes" → `router.back()`
4. **Delete path:** tapping Delete shows `Alert.alert` confirmation → on confirm, expense deleted, sheet closes, expense list refreshes

---

## Constraints

- **Group cannot be changed** on edit — locked to the original group
- **Any group member** can edit or delete (no owner restriction — deliberate product decision)
- No new RPC needed — direct Supabase table access (matches existing pattern in `add-expense.tsx`)
- `splitMethod` always defaults to `'equally'` in edit mode (exact/percent are "coming soon" — no DB column stores original split method)

---

## Required DB Migration

A new migration must add `UPDATE` and `DELETE` RLS policies on `expenses` and `expense_splits`. Without these, all update/delete operations will be silently rejected by Supabase. The policies should allow any member of the group to update/delete:

```sql
-- expenses: UPDATE and DELETE for group members
CREATE POLICY "Group members can update expenses"
  ON expenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Group members can delete expenses"
  ON expenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = expenses.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- expense_splits: UPDATE and DELETE for group members (via expense join)
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

> **Note:** `expense_splits.expense_id` has `ON DELETE CASCADE`, so deleting an expense automatically removes its splits. The explicit `DELETE expense_splits` in edit-mode `handleSave` is intentional (to replace splits atomically during edit, not delete).

---

## Changes by File

### 1. New migration file

Add `supabase/migrations/YYYYMMDDHHMMSS_add_expense_update_delete_policies.sql` with the SQL above.

---

### 2. `app/group/[id].tsx`

**New state:**
```ts
const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
const [deletingExpense, setDeletingExpense] = useState(false);
```

**Expense card:** add `onPress={() => setSelectedExpense(expense)}` to existing `Pressable`.

**Navigation to edit:** pass only `expenseId`, `groupId`, `groupName` as params — **not** the full `Expense` object. The edit form fetches its own raw data.
```ts
router.push({
  pathname: '/add-expense',
  params: { expenseId: selectedExpense.expense_id, groupId: id, groupName: group.name }
});
setSelectedExpense(null);
```

**New detail bottom sheet modal** (same pattern as existing `showSettings` modal):
```tsx
<Modal
  visible={!!selectedExpense}
  transparent
  animationType="slide"
  onRequestClose={() => setSelectedExpense(null)}  // Android back gesture
>
```
Shows: description, formatted total amount, paid by name, split member count, category.
Edit + Delete action buttons at the bottom.

**Delete handler:**
```ts
async function handleDeleteExpense() {
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
          refetchExpenses(); // existing refetch function in this screen
        },
      },
    ]
  );
}
```

---

### 3. `app/add-expense.tsx`

**New route params:**
```ts
const { groupId: urlGroupId, groupName: urlGroupName, expenseId } =
  useLocalSearchParams<{ groupId?: string; groupName?: string; expenseId?: string }>();
const isEditing = !!expenseId;
```

**Edit mode data fetch — explicit query plan:**

Two separate Supabase queries on mount when `isEditing`:

```ts
// Query 1: raw expense row
const { data: expenseRow } = await supabase
  .from('expenses')
  .select('id, description, amount_cents, paid_by_member_id, category, receipt_url')
  .eq('id', expenseId)
  .single();

// Query 2: split member IDs
const { data: splitRows } = await supabase
  .from('expense_splits')
  .select('member_id')
  .eq('expense_id', expenseId);
```

Pre-populate state from these results:
- `setDescription(expenseRow.description)`
- `setAmount((expenseRow.amount_cents / 100).toFixed(2))`
- `setReceiptUri(expenseRow.receipt_url ?? null)`
- Store `expenseRow.paid_by_member_id` in a ref for use after members load
- `setSelectedMembers(new Set(splitRows.map(r => r.member_id)))`
- Category: if known key → `setDetectedCategory(expenseRow.category)`, else `setDetectedCategory('other')` + `setCustomCategory(expenseRow.category)`
- `splitMethod` defaults to `'equally'` always

**`paid_by_member_id` load-order handling:**

`loadMembers` currently auto-sets `paidBy` to the current user. In edit mode, this must be overridden. Strategy: after members finish loading, if `isEditing` and the fetched `paid_by_member_id` is known, call `setPaidBy(fetchedPaidByMemberId)`. Use a `useRef` to pass the fetched value into the `loadMembers` callback:

```ts
const editPaidByRef = useRef<string | null>(null);

// In loadMembers, after setMembers(list):
if (isEditing && editPaidByRef.current) {
  setPaidBy(editPaidByRef.current);
} else if (me) {
  setPaidBy(me.id);
}

// In the edit-mode fetch effect, store before loadMembers resolves:
editPaidByRef.current = expenseRow.paid_by_member_id;
```

**Receipt handling in edit mode:**
- Pre-populate `receiptUri` from `expenseRow.receipt_url`
- If user removes it (existing Remove button), `receiptUri` becomes `null`
- On save, `UPDATE expenses SET receipt_url = receiptUri` (null clears it)
- Storage object cleanup for replaced/removed receipts is out of scope for this feature (a future cleanup task)

**Group selector in edit mode:** render as non-pressable row with lock icon:
```tsx
{isEditing ? (
  <View style={s.groupRow}>
    <View style={s.inputIcon}>
      <MaterialIcons name="group" size={22} color={C.primary} />
    </View>
    <Text style={s.groupRowText}>{groupName}</Text>
    <MaterialIcons name="lock-outline" size={18} color={C.slate500} />
  </View>
) : (
  <Pressable style={...} onPress={() => setGroupPickerOpen(true)}>
    {/* existing group picker row */}
  </Pressable>
)}
```

**Header/button copy:**
- Header title: `isEditing ? 'Edit expense' : 'Add expense'`
- Save button label: `isEditing ? 'Save Changes' : 'Save Expense'`

**`handleSave` in edit mode (3 sequential operations):**
```ts
// 1. UPDATE expense row
const { error: updateErr } = await supabase
  .from('expenses')
  .update({ description: description.trim(), amount_cents: amtCents, paid_by_member_id: paidBy, category: finalCategory, receipt_url: receiptUri })
  .eq('id', expenseId);
if (updateErr) { setError(updateErr.message); setSaving(false); return; }

// 2. DELETE existing splits
const { error: deleteErr } = await supabase
  .from('expense_splits')
  .delete()
  .eq('expense_id', expenseId);
if (deleteErr) { setError(deleteErr.message); setSaving(false); return; }

// 3. INSERT new splits (same equal-split logic as create)
const { error: splitErr } = await supabase.from('expense_splits').insert(splits);
if (splitErr) { setError(splitErr.message); setSaving(false); return; }

// Only navigate back after ALL three succeed
router.back();
```

> **Non-atomic risk:** If DELETE succeeds but INSERT fails, the expense has no splits. This is an accepted risk (no rollback mechanism without a DB transaction/RPC). The error message should prompt the user to retry. `router.back()` is only called on full success.

---

### 4. `app/_layout.tsx`

No changes needed — `add-expense` is already registered as a modal. `expenseId` is an optional param.

---

## Data Operations Summary

| Action | Queries |
|--------|---------|
| Load edit form | SELECT from `expenses` WHERE id; SELECT from `expense_splits` WHERE expense_id |
| Save edit | UPDATE `expenses`; DELETE `expense_splits` WHERE expense_id; INSERT `expense_splits` |
| Delete | DELETE `expenses` WHERE id (splits cascade via `ON DELETE CASCADE`) |

---

## Testing

Unit tests to add/update in `__tests__/`:
- Edit mode renders with pre-populated fields (description, amount, paidBy, selectedMembers)
- Group selector is non-interactive (no onPress) in edit mode
- `handleSave` calls UPDATE + DELETE + INSERT (not just INSERT) in edit mode
- `paidBy` is set from fetched `paid_by_member_id`, not auto-set to current user, in edit mode
- Delete confirmation Alert appears on Delete button press
- Successful delete closes sheet and calls refetch
- Delete error shows Alert and keeps sheet open
