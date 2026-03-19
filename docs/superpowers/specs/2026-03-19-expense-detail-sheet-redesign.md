# Expense Detail Sheet Redesign

**Date:** 2026-03-19
**Status:** Approved
**Branch:** feat/friends-tab

---

## Problem

The current expense detail sheet is a minimal bottom sheet with icon-label-value rows. It shows total amount, paid-by, your share, and category — but no per-member breakdown. The experience doesn't match the richness users expect from a Splitwise-style app.

---

## Goals

- Show a clear, rich expense detail view when tapping an expense card
- Display every group member's individual share with a proportion bar
- Render the basic info (title, amount, payer) immediately; load splits lazily
- Extract the sheet into its own component to keep `group/[id].tsx` maintainable

---

## Non-Goals

- No new Supabase RPC or migration required
- No notes/comments field (not in current data model)
- No receipt image attachment

---

## Design

### Layout — four sections

**① Header**
- Category icon (colour-coded pill, matches existing `CATEGORY_ICONS` map)
- Expense title (large, bold)
- Date formatted as "March 15, 2026 · Restaurant"

**② Hero**
- Total amount in large type (e.g. `$120.00`)
- Payer row: small avatar (initials) + "Paid by You / [Name]"
- Payer avatar: green tint if current user, orange tint if someone else

**③ Split breakdown**
- Section label: "SPLIT BETWEEN" (small caps)
- One row per group member, sorted: current user first, then others alphabetically by `display_name` (treat `null` display names as `'Unknown'` to avoid sort errors)
- Each row: avatar (initials, colour-coded) · name · optional "paid" badge (on payer) · amount
- Below each row: a thin proportion bar — `width = total_amount_cents > 0 ? (member_amount / total_amount_cents) * 100 : 0` (guard against zero-total expenses)
- Current user's row: green tint (`C.primary`); others: `C.orange` if they owe, `C.slate400` if settled/zero balance
- While loading: three animated skeleton rows (pulse animation at 1.2 s period)

**④ Actions**
- Edit button (green tint) and Delete button (red tint), side by side
- Delete button shows `ActivityIndicator` while `deletingExpense` is true
- Both hidden when `isArchived` is true (consistent with existing behaviour)

---

## Data Flow

1. User taps an expense card → `setSelectedExpense(expense)` → `Modal` becomes visible immediately with header + hero rendered
2. A `useEffect` keyed on `selectedExpense?.expense_id` fires:
   - Sets `splitsLoading = true`, clears `splits = []`
   - Queries `supabase.from('expense_splits').select('member_id, amount_cents').eq('expense_id', expense.expense_id)`
   - This hits the existing `UNIQUE(expense_id, member_id)` B-tree index — no migration needed
3. Result rows (`{ member_id, amount_cents }`) are joined **in memory** by matching `split.member_id === member.id` against the `members: GroupMember[]` array already loaded in `GroupDetailScreen` state — no second DB round trip. Members whose `member_id` is not found in `members` (e.g. external contacts removed from group) are shown as "Unknown" with a generic avatar.
4. On query error: `splitsLoading` is set to false, `splits` stays `[]` — skeleton is dismissed and the section is left empty (no error banner; failure is non-critical).
5. Sets `splits`, `splitsLoading = false` → skeleton swaps to real rows
6. On modal close: `setSelectedExpense(null)` — `splits` and `splitsLoading` reset on next open
7. **Race condition:** if the user taps two expenses in rapid succession, both queries may resolve. Since the `useEffect` is keyed on `selectedExpense?.expense_id` (not a boolean), the second query will always win because `selectedExpense` will already reflect the second expense when both resolve. No explicit cancellation is needed for this query size (2–10 rows).

---

## New Interfaces

```ts
interface ExpenseSplit {
  member_id: string;    // matches GroupMember.id (group_members.id PK)
  amount_cents: number;
}
```

---

## New State (GroupDetailScreen)

```ts
const [splits, setSplits] = useState<ExpenseSplit[]>([]);
const [splitsLoading, setSplitsLoading] = useState(false);
```

---

## Component Extraction

The sheet JSX is extracted to **`components/ExpenseDetailSheet.tsx`** (feature-specific component, not a generic UI primitive — lives in `components/` rather than `components/ui/`).

### Props

```ts
interface ExpenseDetailSheetProps {
  expense: Expense | null;           // null = hidden
  splits: ExpenseSplit[];
  splitsLoading: boolean;
  deletingExpense: boolean;          // shows ActivityIndicator on Delete button
  members: GroupMember[];            // for name/avatar lookup; join on split.member_id === member.id
  currentUserId: string;
  isArchived: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  format: (cents: number) => string; // from useCurrency
}
```

`GroupDetailScreen` passes all props down; the component owns no state and makes no Supabase calls — purely presentational.

**Prop threading note:** `isArchived` is sourced from `group.archived ?? false` in `GroupDetailScreen`.

**Colour constants:** `ExpenseDetailSheet.tsx` defines its own local `C` constant (same pattern as `[id].tsx`) using values from `constants/Colors`.

### Safe-area handling

The sheet must apply `useSafeAreaInsets().bottom` as additional bottom padding (or use `SafeAreaView`) so action buttons are not obscured by the home indicator on notched/Dynamic Island devices.

---

## Files Changed

| File | Change |
|---|---|
| `components/ExpenseDetailSheet.tsx` | **New** — full sheet UI |
| `app/group/[id].tsx` | Add `splits` + `splitsLoading` state; add `useEffect` to fetch splits on tap; replace inline sheet JSX with `<ExpenseDetailSheet .../>` |

---

## Database

No changes. The existing `UNIQUE(expense_id, member_id)` constraint on `expense_splits` creates a B-tree index with `expense_id` as leading column. The point-lookup query is O(log n) and returns 2–10 rows.

---

## Testing

### New: `__tests__/components/ExpenseDetailSheet.test.tsx`
- Renders skeleton rows (3) when `splitsLoading=true` and no splits provided
- Renders member rows with correct names/amounts when splits are provided
- Hides Edit and Delete actions when `isArchived=true`
- Shows `ActivityIndicator` on Delete button when `deletingExpense=true`
- Handles unknown `member_id` (not in `members` array) gracefully — shows "Unknown"

### Updated: `__tests__/screens/group-detail-delete.test.tsx`
- Make the `supabase.from` mock in `beforeEach` table-aware. For `expense_splits`, `.eq()` must return a resolved promise directly (the query is `await supabase.from('expense_splits').select(...).eq(...)` with no terminal method). For all other tables, return `this` from `.eq()` so `.single()` / `.maybeSingle()` chains still work.

```ts
// in beforeEach:
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
    maybeSingle: jest.fn().mockResolvedValue({ data: { balance_cents: 6000 }, error: null }),
    single: jest.fn().mockResolvedValue({ data: mockGroup, error: null }),
  };
});
```

This keeps the existing `groups` / `group_balances` / `group_members` chain intact while allowing the new `expense_splits` query to resolve immediately with an empty array, clearing `splitsLoading` and rendering the full sheet (including the "Delete" button the existing tests depend on).
