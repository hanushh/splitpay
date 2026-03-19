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
- One row per group member, sorted: current user first, then others alphabetically
- Each row: avatar (initials, colour-coded) · name · optional "paid" badge (on payer) · amount
- Below each row: a thin proportion bar — `width = (member_amount / total) * 100%`
- Current user's row: green tint; others: orange tint if they owe, slate if settled
- While loading: three animated skeleton rows (pulse animation)

**④ Actions**
- Edit button (green tint) and Delete button (red tint), side by side
- Hidden / disabled on archived groups (consistent with existing behaviour)

---

## Data Flow

1. User taps an expense card → `setSelectedExpense(expense)` → `Modal` becomes visible immediately
2. A `useEffect` keyed on `selectedExpense` fires:
   - Sets `splitsLoading = true`, clears `splits = []`
   - Queries `supabase.from('expense_splits').select('member_id, amount_cents').eq('expense_id', expense.expense_id)`
   - This hits the existing `UNIQUE(expense_id, member_id)` B-tree index — no migration needed
3. Result is joined **in memory** against the `members: GroupMember[]` array already loaded in `GroupDetailScreen` state — no second DB round trip
4. Sets `splits`, `splitsLoading = false` → skeleton swaps to real rows
5. On modal close: `setSelectedExpense(null)` — `splits` and `splitsLoading` reset on next open

---

## New Interfaces

```ts
interface ExpenseSplit {
  member_id: string;
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

The sheet JSX is extracted to **`components/ExpenseDetailSheet.tsx`** (new file).

### Props

```ts
interface ExpenseDetailSheetProps {
  expense: Expense | null;           // null = hidden
  splits: ExpenseSplit[];
  splitsLoading: boolean;
  members: GroupMember[];            // for name/avatar lookup
  currentUserId: string;
  isArchived: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  format: (cents: number) => string; // from useCurrency
}
```

`GroupDetailScreen` passes all props down; the component owns no state and makes no Supabase calls — purely presentational.

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

- Unit test for `ExpenseDetailSheet`: renders skeleton while `splitsLoading=true`, renders member rows when splits are provided, hides actions when `isArchived=true`
- Update existing `group-detail-delete.test.tsx` to mock `expense_splits` query (add to `supabase.from` mock)
