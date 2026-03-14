# Settle-Up Completion — Design Spec

**Date**: 2026-03-14
**Status**: Approved

---

## Problem

The settle-up screen UI is complete but non-functional. `handleSave` calls `router.back()` with no persistence. Balances never reflect payments, so users have no way to close out debts.

The callers of the settle-up screen (`group/balances.tsx`, `group/[id].tsx`) also don't pass `friendMemberId`, so the screen has no counterparty to record a settlement against.

---

## Goals

- Record settlements to the database atomically
- Keep all balance views consistent: home screen total, group balances banner, per-member list, cross-group friends tab
- Show settlements in the activity feed as a distinct event type
- Support partial settlements (editable amount pre-filled from outstanding balance)

---

## Non-Goals

- Settlement deletion / reversal
- Push notifications for settlements
- Receipt photo upload for settlements (UI stub remains, no-op)

---

## Balance Sign Convention

`balance_cents` is always from the **current user's perspective**:
- **Positive** = counterparty owes the current user
- **Negative** = current user owes the counterparty

This is the existing convention in `group_balances`, `get_group_member_balances`, and `get_friend_balances`.

---

## Invariant: The payer is always the current authenticated user

A settlement can only be recorded by the person making the payment. The RPC derives the payer's `group_members.id` internally from `auth.uid() + p_group_id`, so `p_payer_member_id` is never a caller-supplied parameter. This eliminates auth guard ambiguity and prevents any forgery of another user's payment.

---

## Data Layer

### New table: `settlements`

```sql
CREATE TABLE public.settlements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  payer_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  payee_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount_cents     INTEGER     NOT NULL CHECK (amount_cents > 0),
  payment_method   TEXT        NOT NULL DEFAULT 'cash',  -- 'cash' | 'venmo' | 'other'
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group members can read settlements"
  ON public.settlements FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

-- Direct inserts are gated to group members; record_settlement (SECURITY DEFINER)
-- is the intended write path and enforces stronger invariants.
CREATE POLICY "group members can insert settlements"
  ON public.settlements FOR INSERT
  WITH CHECK (public.is_group_member(group_id, auth.uid()));
```

### New RPC: `record_settlement`

**Signature** — `p_payer_member_id` is intentionally absent; the payer is always derived from `auth.uid()`. The function is `SECURITY DEFINER` (runs as DB owner, bypasses RLS) — this is required so that the `UPDATE group_balances ... WHERE user_id = v_payee_user_id` succeeds even though the caller is not the payee. All write RPCs in this codebase follow the same pattern.

```sql
CREATE OR REPLACE FUNCTION public.record_settlement(
  p_group_id        UUID,
  p_payee_member_id UUID,
  p_amount_cents    INTEGER,
  p_payment_method  TEXT DEFAULT 'cash',
  p_note            TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE PLPGSQL SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settlement_id   UUID;
  v_payer_member_id UUID;
  v_payee_user_id   UUID;
BEGIN
  -- Derive payer member from calling user's membership in this group
  SELECT id INTO v_payer_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_payer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  -- Resolve payee user_id (nullable — payee may be an external contact)
  SELECT user_id INTO v_payee_user_id
  FROM public.group_members WHERE id = p_payee_member_id;

  -- Insert settlement
  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note
  )
  VALUES (
    p_group_id, v_payer_member_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note
  )
  RETURNING id INTO v_settlement_id;

  -- NOTE: record_settlement is SECURITY DEFINER (runs as the DB owner),
  -- so RLS on group_balances is bypassed here. This is intentional and
  -- consistent with all other write RPCs in this codebase.

  -- Payer's balance increases (they owe less / are owed more)
  UPDATE public.group_balances
  SET balance_cents = balance_cents + p_amount_cents
  WHERE group_id = p_group_id AND user_id = auth.uid();

  -- Payee's balance decreases (they are owed less / owe more)
  -- Skipped if payee is an external contact with no auth account.
  IF v_payee_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - p_amount_cents
    WHERE group_id = p_group_id AND user_id = v_payee_user_id;
  END IF;

  RETURN v_settlement_id;
END;
$$;
```

### Modified RPC: `get_group_member_balances`

Add a `net_settlements` CTE. The formula `COALESCE(SUM(raw_balances), 0) - COALESCE(SUM(settled_cents), 0)` adjusts each member's balance for settlements.

**`settled_cents` sign convention** and **outer combining formula:**

The outer query computes: `final_balance = raw_balance - settled_cents`

| Who is payer | `settled_cents` value | Effect of `raw - settled_cents` |
|---|---|---|
| Current user | `-amount_cents` (negative) | `balance - (-amount) = balance + amount` → balance increases toward 0 from negative side |
| Counterparty | `+amount_cents` (positive) | `balance - (+amount) = balance - amount` → balance decreases toward 0 from positive side |

**Verification:**
- User owes member $100 (`balance = -100`), user pays $50: `settled_cents = -50`, `-100 - (-50) = -50` ✓
- Member owes user $100 (`balance = +100`), member pays $50: `settled_cents = +50`, `100 - 50 = 50` ✓

The combining formula `COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)` appears explicitly in the replacement SQL below and in the `ORDER BY` clause — both must use this formula.

```sql
CREATE OR REPLACE FUNCTION public.get_group_member_balances(p_group_id UUID, p_user_id UUID)
RETURNS TABLE (
  member_id     UUID,
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_member AS (
    SELECT id FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id LIMIT 1
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND e.paid_by_member_id = (SELECT id FROM my_member)
      AND es.member_id != (SELECT id FROM my_member)
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, -es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    WHERE e.group_id = p_group_id
      AND es.member_id = (SELECT id FROM my_member)
      AND e.paid_by_member_id != (SELECT id FROM my_member)
  ),
  raw_balances AS (
    SELECT member_id, balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, balance_cents FROM i_owe
  ),
  net_settlements AS (
    SELECT
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN payee_member_id
        ELSE payer_member_id
      END AS member_id,
      CASE
        WHEN payer_member_id = (SELECT id FROM my_member) THEN -amount_cents::BIGINT
        ELSE                                                     amount_cents::BIGINT
      END AS settled_cents
    FROM public.settlements
    WHERE group_id = p_group_id
      AND (
        payer_member_id = (SELECT id FROM my_member)
        OR payee_member_id = (SELECT id FROM my_member)
      )
  )
  SELECT
    gm.id,
    gm.display_name,
    gm.avatar_url,
    COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) AS balance_cents
  FROM public.group_members gm
  LEFT JOIN raw_balances   rb ON rb.member_id = gm.id
  LEFT JOIN net_settlements ns ON ns.member_id = gm.id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url
  ORDER BY ABS(
    COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)
  ) DESC;
$$;
```

### Modified RPC: `get_friend_balances`

Applies the same `settled_cents` sign convention, scoped across all groups via the `my_members` CTE.

**Note on external contacts:** settlements reference `group_members.id` directly, so the join is unambiguous per member row. The pre-existing fragility where two external contacts with the same `display_name` in different groups are collapsed under the same `GROUP BY display_name, user_id` entry (when `user_id IS NULL`) is out of scope for this feature — it pre-dates settlements and is not worsened by them.

```sql
CREATE OR REPLACE FUNCTION public.get_friend_balances(p_user_id UUID)
RETURNS TABLE (
  display_name  TEXT,
  avatar_url    TEXT,
  balance_cents BIGINT,
  user_id       UUID
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH my_members AS (
    SELECT id AS member_id, group_id
    FROM public.group_members WHERE user_id = p_user_id
  ),
  owed_to_me AS (
    SELECT es.member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = e.paid_by_member_id AND mm.group_id = e.group_id
    WHERE es.member_id != e.paid_by_member_id
  ),
  i_owe AS (
    SELECT e.paid_by_member_id AS member_id, es.amount_cents::BIGINT AS balance_cents
    FROM public.expense_splits es
    JOIN public.expenses e ON e.id = es.expense_id
    JOIN my_members mm ON mm.member_id = es.member_id AND mm.group_id = e.group_id
    WHERE e.paid_by_member_id != es.member_id
  ),
  expense_balances AS (
    SELECT member_id,  balance_cents FROM owed_to_me
    UNION ALL
    SELECT member_id, -balance_cents FROM i_owe
  ),
  net_settlements AS (
    SELECT
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN s.payee_member_id
        ELSE s.payer_member_id
      END AS member_id,
      CASE
        WHEN s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
          THEN -s.amount_cents::BIGINT
        ELSE   s.amount_cents::BIGINT
      END AS settled_cents
    FROM public.settlements s
    WHERE (
      s.payer_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
      OR s.payee_member_id IN (SELECT member_id FROM my_members WHERE group_id = s.group_id)
    )
  )
  SELECT
    gm.display_name,
    MAX(gm.avatar_url) AS avatar_url,
    COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) AS balance_cents,
    gm.user_id
  FROM public.group_members gm
  LEFT JOIN expense_balances eb ON eb.member_id = gm.id
  LEFT JOIN net_settlements  ns ON ns.member_id  = gm.id
  WHERE (gm.user_id IS NULL OR gm.user_id != p_user_id)
  GROUP BY gm.display_name, gm.user_id
  HAVING COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0) != 0
  ORDER BY ABS(COALESCE(SUM(eb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)) DESC;
$$;
```

### Modified RPC: `get_user_activity`

UNIONs settlements into the expense result. Wrapped in a subquery so `ORDER BY`/`LIMIT` apply to the combined set.

**Column mapping for settlement rows:**
| Column | Value | Rationale |
|---|---|---|
| `expense_id` | `s.id` | Reused as unique row key (deliberate — avoids schema change; field is semantically "row ID" here) |
| `description` | `'Settlement'` | Static label; client overrides display based on `category` |
| `category` | `'settlement'` | Triggers distinct rendering branch in `activity.tsx` |
| `total_amount_cents` | `s.amount_cents` | The full settled amount |
| `paid_by_name` | `payer.display_name` | Who made the payment (payer's own name) |
| `paid_by_avatar` | `payer.avatar_url` | — |
| `paid_by_is_user` | `payer.user_id = p_user_id` | `true` if current user paid |
| `your_split_cents` | `s.amount_cents` | Full amount — activity.tsx will NOT use the "you lent/you owe" label logic for `category = 'settlement'`; see client rendering below |
| `payee_name` *(new column)* | `payee.display_name` (via JOIN on `s.payee_member_id`) | The recipient's name — needed for "You paid [payee_name]" label. `NULL` for expense rows. |

**Important:** `paid_by_name` is the payer's own name. Using it in a "You paid [X]" label would render "You paid [yourself]". The `payee_name` column is added specifically to resolve this. Both UNION branches must include this column: `NULL::TEXT AS payee_name` for expenses, `payee.display_name AS payee_name` for settlements.

The `ActivityRow` TypeScript interface gains an optional `payee_name?: string | null` field.

The `membership` lateral join uses `LIMIT 1` to prevent duplicate rows for edge-case users with multiple `group_members` rows in the same group.

```sql
CREATE OR REPLACE FUNCTION public.get_user_activity(p_user_id UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (
  expense_id          UUID,
  group_id            UUID,
  group_name          TEXT,
  description         TEXT,
  total_amount_cents  INTEGER,
  category            TEXT,
  created_at          TIMESTAMPTZ,
  paid_by_name        TEXT,
  paid_by_avatar      TEXT,
  paid_by_is_user     BOOLEAN,
  your_split_cents    INTEGER,
  payee_name          TEXT   -- NULL for expenses; payee's display_name for settlements
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM (
    -- Expenses (unchanged logic, payee_name is NULL)
    SELECT
      e.id,
      e.group_id,
      g.name,
      e.description,
      e.amount_cents,
      e.category,
      e.created_at,
      COALESCE(payer.display_name, 'Someone') AS paid_by_name,
      payer.avatar_url                          AS paid_by_avatar,
      (payer.user_id = p_user_id)              AS paid_by_is_user,
      COALESCE(my_split.amount_cents, 0)       AS your_split_cents,
      NULL::TEXT                               AS payee_name
    FROM public.expenses e
    JOIN public.groups g ON g.id = e.group_id
    JOIN public.group_members membership
      ON membership.group_id = e.group_id AND membership.user_id = p_user_id
    LEFT JOIN public.group_members payer ON payer.id = e.paid_by_member_id
    LEFT JOIN public.expense_splits my_split
      ON my_split.expense_id = e.id AND my_split.member_id = membership.id

    UNION ALL

    -- Settlements
    SELECT
      s.id,
      s.group_id,
      g.name,
      'Settlement'                       AS description,
      s.amount_cents,
      'settlement'                       AS category,
      s.created_at,
      payer.display_name                 AS paid_by_name,
      payer.avatar_url                   AS paid_by_avatar,
      (payer.user_id = p_user_id)       AS paid_by_is_user,
      s.amount_cents                     AS your_split_cents,
      payee.display_name                 AS payee_name
    FROM public.settlements s
    JOIN public.groups g ON g.id = s.group_id
    JOIN LATERAL (
      SELECT id FROM public.group_members
      WHERE group_id = s.group_id AND user_id = p_user_id
      LIMIT 1
    ) membership ON true
    JOIN public.group_members payer ON payer.id = s.payer_member_id
    JOIN public.group_members payee ON payee.id = s.payee_member_id
    WHERE s.payer_member_id = membership.id OR s.payee_member_id = membership.id
  ) combined
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;
```

---

## Hook: `useSettlement`

New file: `hooks/use-settlement.ts`

The hook calls `record_settlement` with the payee, amount, method, and note. The RPC derives the payer internally — the hook does **not** need to look up the payer's member ID.

**`settle` signature:** takes `SettleParams` at call time, returns `Promise<boolean>` (`true` = success, `false` = failure with `error` state set).

```ts
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SettleParams {
  groupId: string;
  payeeMemberId: string;
  amountCents: number;
  paymentMethod: 'cash' | 'venmo' | 'other';
  note?: string;
}

export function useSettlement() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = useCallback(async (params: SettleParams): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('record_settlement', {
        p_group_id:        params.groupId,
        p_payee_member_id: params.payeeMemberId,
        p_amount_cents:    params.amountCents,
        p_payment_method:  params.paymentMethod,
        p_note:            params.note ?? null,
      });
      if (rpcErr) throw rpcErr;
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record settlement');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { settle, loading, error };
}
```

---

## Screen Changes

### `app/settle-up.tsx`

**Route params** — add `friendMemberId`:
```ts
const { groupId, groupName, friendName, amountCents, friendMemberId } =
  useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
    friendName?: string;
    amountCents?: string;
    friendMemberId?: string;
  }>();
```

**Amount state** — add editable `TextInput` replacing the static `Text` in the amount card:
- State: `const [amountInput, setAmountInput] = useState<string>(amountCents ? (Number(amountCents) / 100).toFixed(2) : '')`
- Replace `<Text style={s.amountValue}>{amount}</Text>` with a `TextInput` using `keyboardType="decimal-pad"`, value `amountInput`, `onChangeText={setAmountInput}`, styled identically to `s.amountValue`

**Fix `saving` state:**
```ts
// Before:
const [saving] = useState(false);
// After:
const [saving, setSaving] = useState(false);
```

**Validation helpers** (derived values, not state):
```ts
const parsedCents = Math.round(parseFloat(amountInput) * 100);
const isValidAmount = !isNaN(parsedCents) && parsedCents > 0;
const isOverpayment = amountCents ? parsedCents > Number(amountCents) : false;
const canSave = isValidAmount && !!friendMemberId && !!groupId && !saving;
```

**Guard** — if `friendMemberId` is absent, render a red inline message above the save button and `canSave` will be `false`. Do not auto-navigate.

**Amber overpayment warning** — show `"This exceeds the outstanding balance"` in amber text below the amount input when `isOverpayment` is true. Save remains enabled.

**Wire `handleSave`:**
```ts
const handleSave = async () => {
  if (!canSave) return;
  setSaving(true);
  const ok = await settle({
    groupId: groupId!,
    payeeMemberId: friendMemberId!,
    amountCents: parsedCents,
    paymentMethod,
    note: note.trim() || undefined,
  });
  setSaving(false);
  if (ok) router.back();
};
```

**Error banner** — render `error` from `useSettlement` in a red banner immediately below the header when non-null.

### `app/group/balances.tsx`

Update "Settle up" / "Pay" `router.push` call:
```ts
router.push({
  pathname: '/settle-up',
  params: {
    groupId,
    groupName,
    friendName: m.display_name,
    friendMemberId: m.id,       // m.id is group_members.id per the RPC return type
    amountCents: String(Math.abs(m.balance_cents)),
  },
})
```

Note: the settle button is only rendered when `m.balance_cents !== 0` (existing condition), so `amountCents` passed will always be > 0.

Add `useFocusEffect` to refetch on return from settle-up:
```ts
useFocusEffect(useCallback(() => { fetchBalances(); }, [fetchBalances]));
```

Note: the existing `totalText` formatting bug (`-${format(totalCents)}` when `totalCents` is negative) is a pre-existing issue and is out of scope for this feature.

### `app/group/[id].tsx`

Change the "Settle up" button from navigating to `/settle-up` to `/group/balances` — a group-level settle has no counterparty:
```ts
onPress={() => router.push({
  pathname: '/group/balances',
  params: { groupId: id, groupName: group.name }
})}
```

### `app/(tabs)/activity.tsx`

Add `'settlement'` to the category → icon mapping.

**Rendering:** when `item.category === 'settlement'`, branch away from the standard `ActivityCard` expense logic entirely. The existing card computes:

```ts
const yourAmount = item.paid_by_is_user
  ? item.total_amount_cents - item.your_split_cents  // net lent
  : item.your_split_cents;                           // your share owed
```

For settlements `total_amount_cents === your_split_cents`, so `yourAmount = 0` when `paid_by_is_user` is true — which is wrong. The settlement branch must use `item.total_amount_cents` directly as the display amount:

```ts
if (item.category === 'settlement') {
  const label = item.paid_by_is_user
    ? `You paid ${item.payee_name ?? 'someone'}`   // payee_name = who received the payment
    : `${item.paid_by_name ?? 'Someone'} paid you`; // paid_by_name = who sent the payment
  return (
    // Render settlement row:
    // - Icon: MaterialIcons 'payments', color C.primary
    // - Primary text: label
    // - Amount: format(item.total_amount_cents) in green (C.primary)
    // - No "you lent / you owe" sub-label
  );
}
```

The exact component structure (whether this is a new `SettlementActivityRow` component or an inline branch in the existing `renderItem`) is left to the implementer, provided the amount shown is `total_amount_cents` and the "you lent / you owe" sub-label is absent.

---

## Migration File

Single file: `supabase/migrations/20260314100000_add_settlements.sql`

This runs after `20260314000000_fix_recursive_rls_policies.sql` (already on this branch), which is fine — the timestamps ensure correct ordering on fresh deploys.

Order of statements in the file:
1. Create `settlements` table + RLS policies
2. Create `record_settlement` RPC
3. `CREATE OR REPLACE FUNCTION get_group_member_balances` (full replacement)
4. `CREATE OR REPLACE FUNCTION get_friend_balances` (full replacement)
5. `CREATE OR REPLACE FUNCTION get_user_activity` (full replacement)

---

## Error Handling

| Scenario | Handling |
|---|---|
| `friendMemberId` missing | Red inline message, save disabled |
| Amount ≤ 0 or non-numeric | `canSave = false`, save disabled |
| Amount > outstanding balance | Amber warning below input, save **enabled** |
| User not member of group (RPC) | Error banner, no navigation |
| RPC error (network / DB) | Error banner, no navigation |
| Double-tap | `saving = true` disables button during flight |

---

## Acceptance Criteria

- [ ] User can record a full or partial settlement from the balances screen
- [ ] Overpayment is permitted (amber warning shown; saves successfully)
- [ ] Per-member balance in `group/balances.tsx` reflects the settlement after refocus
- [ ] Home screen group total balance (`group_balances` row) reflects the settlement
- [ ] Friends tab cross-group balance reflects the settlement
- [ ] Settlement appears in the activity feed with the correct label and payment icon
- [ ] Save is disabled when amount is invalid or `friendMemberId` is absent
- [ ] RPC errors surface as a visible banner; screen does not navigate back on failure
- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass
