# Settle-Up Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the settle-up screen actually record payments to the database and keep all balance views consistent.

**Architecture:** A new `settlements` Postgres table stores individual payment records. A `record_settlement` SECURITY DEFINER RPC inserts the row and updates the stored `group_balances` totals atomically. Three existing balance/activity RPCs are replaced with versions that subtract net settlements from computed balances. A new `useSettlement` hook wraps the RPC. Four screens are updated: settle-up (wired), group/balances (passes member ID), group/[id] (re-routed), and activity (new rendering branch).

**Tech Stack:** Supabase/Postgres (SQL migrations, PLPGSQL RPCs), React Native, TypeScript strict, Jest + @testing-library/react-native, Expo Router, pnpm

**Spec:** `docs/superpowers/specs/2026-03-14-settle-up-completion-design.md`

---

## Chunk 1: Database Migration

### Task 1: Create the migration file

**Files:**
- Create: `supabase/migrations/20260314100000_add_settlements.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260314100000_add_settlements.sql
-- Runs after 20260314000000_fix_recursive_rls_policies.sql (already on branch)

-- ── 1. settlements table ──────────────────────────────────────────────────────
CREATE TABLE public.settlements (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  payer_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  payee_member_id  UUID        NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount_cents     INTEGER     NOT NULL CHECK (amount_cents > 0),
  payment_method   TEXT        NOT NULL DEFAULT 'cash',
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group members can read settlements"
  ON public.settlements FOR SELECT
  USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "group members can insert settlements"
  ON public.settlements FOR INSERT
  WITH CHECK (public.is_group_member(group_id, auth.uid()));

-- ── 2. record_settlement RPC ──────────────────────────────────────────────────
-- Derives payer from auth.uid() — caller cannot forge another user's payment.
-- SECURITY DEFINER so it can UPDATE group_balances for the payee (who is not the caller).
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
  SELECT id INTO v_payer_member_id
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = auth.uid()
  LIMIT 1;

  IF v_payer_member_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this group';
  END IF;

  SELECT user_id INTO v_payee_user_id
  FROM public.group_members WHERE id = p_payee_member_id;

  INSERT INTO public.settlements (
    group_id, payer_member_id, payee_member_id,
    amount_cents, payment_method, note
  )
  VALUES (
    p_group_id, v_payer_member_id, p_payee_member_id,
    p_amount_cents, p_payment_method, p_note
  )
  RETURNING id INTO v_settlement_id;

  -- Payer's balance increases (they owe less / are owed more)
  UPDATE public.group_balances
  SET balance_cents = balance_cents + p_amount_cents
  WHERE group_id = p_group_id AND user_id = auth.uid();

  -- Payee's balance decreases (they are owed less / owe more)
  IF v_payee_user_id IS NOT NULL THEN
    UPDATE public.group_balances
    SET balance_cents = balance_cents - p_amount_cents
    WHERE group_id = p_group_id AND user_id = v_payee_user_id;
  END IF;

  RETURN v_settlement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_settlement TO authenticated;

-- ── 3. get_group_member_balances (full replacement) ───────────────────────────
-- Adds net_settlements CTE. Sign: payer=me → settled_cents=-amount;
-- counterparty=payer → settled_cents=+amount.
-- Final balance = raw_balance - settled_cents (double-negative increases toward 0).
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
  LEFT JOIN raw_balances    rb ON rb.member_id = gm.id
  LEFT JOIN net_settlements ns ON ns.member_id  = gm.id
  WHERE gm.group_id = p_group_id
    AND gm.id != (SELECT id FROM my_member)
  GROUP BY gm.id, gm.display_name, gm.avatar_url
  ORDER BY ABS(
    COALESCE(SUM(rb.balance_cents), 0) - COALESCE(SUM(ns.settled_cents), 0)
  ) DESC;
$$;

-- ── 4. get_friend_balances (full replacement) ─────────────────────────────────
-- Same settled_cents sign convention, scoped via my_members across all groups.
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

-- ── 5. get_user_activity (full replacement) ───────────────────────────────────
-- UNIONs settlements into expenses. ORDER BY/LIMIT on outermost subquery.
-- Adds payee_name column (NULL for expenses, payee display_name for settlements).
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
  payee_name          TEXT
)
LANGUAGE SQL SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT * FROM (
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

- [ ] **Step 2: Apply migration to local/staging Supabase**

If using Supabase CLI linked to staging (`.env.development`):
```bash
supabase db push
```

Or apply manually via the Supabase Studio SQL editor. Confirm no errors in output.

- [ ] **Step 3: Commit the migration**

```bash
git add supabase/migrations/20260314100000_add_settlements.sql
git commit -m "feat(db): add settlements table and update balance/activity RPCs"
```

---

## Chunk 2: useSettlement Hook

### Task 2: Write the failing hook test

**Files:**
- Create: `__tests__/hooks/use-settlement.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// __tests__/hooks/use-settlement.test.ts
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSettlement } from '@/hooks/use-settlement';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');

beforeEach(() => jest.clearAllMocks());

const params = {
  groupId: 'group-1',
  payeeMemberId: 'member-2',
  amountCents: 5000,
  paymentMethod: 'cash' as const,
  note: 'test note',
};

describe('useSettlement', () => {
  it('calls record_settlement RPC with correct params and returns true on success', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: 'settlement-uuid', error: null });

    const { result } = renderHook(() => useSettlement());

    let ok: boolean;
    await act(async () => {
      ok = await result.current.settle(params);
    });

    expect(supabase.rpc).toHaveBeenCalledWith('record_settlement', {
      p_group_id:        'group-1',
      p_payee_member_id: 'member-2',
      p_amount_cents:    5000,
      p_payment_method:  'cash',
      p_note:            'test note',
    });
    expect(ok!).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('sets error and returns false when RPC returns an error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'You are not a member of this group' },
    });

    const { result } = renderHook(() => useSettlement());

    let ok: boolean;
    await act(async () => {
      ok = await result.current.settle(params);
    });

    expect(ok!).toBe(false);
    expect(result.current.error).toBe('You are not a member of this group');
    expect(result.current.loading).toBe(false);
  });

  it('sets loading true during the call and false after', async () => {
    let resolveRpc!: (v: object) => void;
    (supabase.rpc as jest.Mock).mockReturnValueOnce(
      new Promise((res) => { resolveRpc = res; })
    );

    const { result } = renderHook(() => useSettlement());

    act(() => { result.current.settle(params); });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveRpc({ data: 'uuid', error: null });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('clears a previous error on a new successful call', async () => {
    (supabase.rpc as jest.Mock)
      .mockResolvedValueOnce({ data: null, error: { message: 'first error' } })
      .mockResolvedValueOnce({ data: 'uuid', error: null });

    const { result } = renderHook(() => useSettlement());

    await act(async () => { await result.current.settle(params); });
    expect(result.current.error).toBe('first error');

    await act(async () => { await result.current.settle(params); });
    expect(result.current.error).toBeNull();
  });

  it('omits p_note when note is undefined', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: 'uuid', error: null });
    const { result } = renderHook(() => useSettlement());
    await act(async () => {
      await result.current.settle({ ...params, note: undefined });
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'record_settlement',
      expect.objectContaining({ p_note: null })
    );
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail with "Cannot find module"**

```bash
cd /Users/hnair/Documents/Projects/splitwise && pnpm test __tests__/hooks/use-settlement.test.ts
```

Expected: FAIL — `Cannot find module '@/hooks/use-settlement'`

### Task 3: Implement useSettlement

**Files:**
- Create: `hooks/use-settlement.ts`

- [ ] **Step 3: Create the hook**

```ts
// hooks/use-settlement.ts
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
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Failed to record settlement');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { settle, loading, error };
}
```

- [ ] **Step 4: Run tests — expect all 5 to pass**

```bash
pnpm test __tests__/hooks/use-settlement.test.ts
```

Expected: PASS — 5 tests passed

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
pnpm test
```

Expected: all existing tests still pass

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add hooks/use-settlement.ts __tests__/hooks/use-settlement.test.ts
git commit -m "feat: add useSettlement hook"
```

---

## Chunk 3: Screen Changes

### Task 4: Update `app/settle-up.tsx`

**Files:**
- Modify: `app/settle-up.tsx`

The full updated file (replace entirely):

- [ ] **Step 1: Replace `app/settle-up.tsx` with the wired version**

```tsx
import { MaterialIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useCurrency } from '@/context/currency';
import { useSettlement } from '@/hooks/use-settlement';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const C = {
  primary: '#17e86b',
  amber: '#f59e0b',
  danger: '#ff5252',
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  slate400: '#94a3b8',
  slate500: '#64748b',
  white: '#ffffff',
};

type PaymentMethod = 'cash' | 'venmo' | 'other';

export default function SettleUpScreen() {
  const insets = useSafeAreaInsets();
  const { groupId, groupName, friendName, amountCents, friendMemberId } =
    useLocalSearchParams<{
      groupId?: string;
      groupName?: string;
      friendName?: string;
      amountCents?: string;
      friendMemberId?: string;
    }>();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [amountInput, setAmountInput] = useState<string>(
    amountCents ? (Number(amountCents) / 100).toFixed(2) : ''
  );

  const { settle, error } = useSettlement();
  const { format } = useCurrency();

  const parsedCents = Math.round(parseFloat(amountInput) * 100);
  const isValidAmount = !isNaN(parsedCents) && parsedCents > 0;
  const isOverpayment = amountCents ? parsedCents > Number(amountCents) : false;
  const canSave = isValidAmount && !!friendMemberId && !!groupId && !saving;

  const payeeName = friendName ?? groupName ?? 'your group';
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

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

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={24} color={C.white} />
        </Pressable>
        <Text style={s.headerTitle}>Settle Up</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Error banner */}
      {error ? (
        <View style={s.errorBanner}>
          <MaterialIcons name="error-outline" size={16} color={C.white} />
          <Text style={s.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      {/* Missing friendMemberId guard */}
      {!friendMemberId ? (
        <View style={s.errorBanner}>
          <MaterialIcons name="error-outline" size={16} color={C.white} />
          <Text style={s.errorBannerText}>No payee selected. Go back and tap Settle up on a specific member.</Text>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Amount card */}
        <View style={s.amountCard}>
          <View style={s.checkCircle}>
            <MaterialIcons name="check-circle" size={52} color={C.primary} />
          </View>
          <Text style={s.amountLabel}>You paid {payeeName}</Text>
          <TextInput
            style={s.amountValue}
            value={amountInput}
            onChangeText={setAmountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={C.slate400}
            selectTextOnFocus
          />
          {isOverpayment && (
            <Text style={s.overpaymentWarning}>This exceeds the outstanding balance</Text>
          )}
          {groupName && (
            <View style={s.groupBadge}>
              <MaterialIcons name="group" size={14} color={C.primary} />
              <Text style={s.groupBadgeText}>{groupName}</Text>
            </View>
          )}
        </View>

        {/* Payment method */}
        <Text style={s.sectionTitle}>PAYMENT METHOD</Text>
        <View style={s.methodList}>
          {([
            { id: 'cash' as const, icon: 'payments', label: 'Record a cash payment', sub: 'No transfer needed' },
            { id: 'venmo' as const, icon: 'account-balance-wallet', label: 'Pay via Venmo/PayPal', sub: 'Open external app' },
          ] as const).map((m) => (
            <Pressable
              key={m.id}
              style={[s.methodCard, paymentMethod === m.id && s.methodCardActive]}
              onPress={() => setPaymentMethod(m.id)}
            >
              <View style={[s.methodIcon, paymentMethod === m.id && s.methodIconActive]}>
                <MaterialIcons name={m.icon} size={22} color={paymentMethod === m.id ? C.bg : C.primary} />
              </View>
              <View style={s.methodInfo}>
                <Text style={[s.methodLabel, paymentMethod === m.id && { color: C.white }]}>{m.label}</Text>
                <Text style={s.methodSub}>{m.sub}</Text>
              </View>
              <View style={[s.radio, paymentMethod === m.id && s.radioActive]}>
                {paymentMethod === m.id && <View style={s.radioDot} />}
              </View>
            </Pressable>
          ))}
        </View>

        {/* Date */}
        <Text style={s.sectionTitle}>DATE</Text>
        <Pressable style={s.infoRow}>
          <MaterialIcons name="calendar-today" size={20} color={C.slate400} />
          <Text style={s.infoText}>{today}</Text>
          <MaterialIcons name="chevron-right" size={20} color={C.slate400} />
        </Pressable>

        {/* Note */}
        <Text style={s.sectionTitle}>NOTE (OPTIONAL)</Text>
        <View style={s.noteRow}>
          <MaterialIcons name="edit-note" size={20} color={C.slate400} />
          <TextInput
            style={s.noteInput}
            placeholder="Add a note…"
            placeholderTextColor={C.slate400}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        {/* Receipt */}
        <Pressable style={s.receiptBtn}>
          <MaterialIcons name="add-a-photo" size={20} color={C.slate400} />
          <Text style={s.receiptText}>Add a receipt image</Text>
        </Pressable>
      </ScrollView>

      {/* Save */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.saveBtn,
            (!canSave || pressed) && { opacity: 0.5 },
          ]}
          onPress={handleSave}
          disabled={!canSave}
        >
          <MaterialIcons name="check" size={20} color={C.bg} />
          <Text style={s.saveBtnText}>{saving ? 'Saving…' : 'Save Payment'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  backBtn: { padding: 10 },
  headerTitle: { color: C.white, fontWeight: '700', fontSize: 18 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#7f1d1d', marginHorizontal: 16, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  errorBannerText: { color: C.white, fontSize: 13, flex: 1 },
  scrollContent: { paddingBottom: 100 },
  amountCard: { alignItems: 'center', margin: 16, backgroundColor: C.surface, borderRadius: 20, padding: 28, gap: 8, borderWidth: 1, borderColor: C.surfaceHL },
  checkCircle: { marginBottom: 4 },
  amountLabel: { color: C.slate400, fontSize: 15 },
  amountValue: { color: C.white, fontSize: 36, fontWeight: '700', textAlign: 'center', minWidth: 120 },
  overpaymentWarning: { color: C.amber, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(23,232,107,0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginTop: 4 },
  groupBadgeText: { color: C.primary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { color: C.slate400, fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, marginTop: 20, marginBottom: 10 },
  methodList: { paddingHorizontal: 16, gap: 10 },
  methodCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: C.surfaceHL },
  methodCardActive: { borderColor: C.primary, backgroundColor: 'rgba(23,232,107,0.06)' },
  methodIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(23,232,107,0.1)', alignItems: 'center', justifyContent: 'center' },
  methodIconActive: { backgroundColor: C.primary },
  methodInfo: { flex: 1 },
  methodLabel: { color: C.slate400, fontWeight: '600', fontSize: 15 },
  methodSub: { color: C.slate500, fontSize: 12, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.slate400, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: C.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.surfaceHL },
  infoText: { flex: 1, color: C.white, fontSize: 15 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 16, backgroundColor: C.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.surfaceHL, minHeight: 80 },
  noteInput: { flex: 1, color: C.white, fontSize: 15, textAlignVertical: 'top' },
  receiptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, margin: 16, marginTop: 12, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: C.surfaceHL, borderStyle: 'dashed' },
  receiptText: { color: C.slate400, fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.surfaceHL, backgroundColor: C.bg },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 16, paddingVertical: 16 },
  saveBtnText: { color: C.bg, fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/settle-up.tsx
git commit -m "feat: wire settle-up screen — editable amount, save, error handling"
```

---

### Task 5: Update `app/group/balances.tsx`

**Files:**
- Modify: `app/group/balances.tsx`

Two changes: (a) pass `friendMemberId` + `amountCents` to the settle-up route params, (b) add `useFocusEffect` to refetch on screen focus.

- [ ] **Step 1: Add `useFocusEffect` to the `expo-router` import**

`app/group/balances.tsx` already imports from `expo-router`. Add `useFocusEffect` to that same import line (not `@react-navigation/native` — this codebase uses `expo-router` for all navigation imports):

```ts
// Before:
import { router, useLocalSearchParams } from 'expo-router';
// After:
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
```

- [ ] **Step 2: Add `useFocusEffect` call inside the component**

After the existing `useEffect` block (line ~69):
```ts
useFocusEffect(useCallback(() => { fetchBalances(); }, [fetchBalances]));
```

- [ ] **Step 3: Update the `router.push` in the settle button**

Find the existing `router.push` call on line ~146:
```ts
onPress={() => router.push({ pathname: '/settle-up', params: { groupId, groupName, friendName: m.display_name } })}
```

Replace with:
```ts
onPress={() => router.push({
  pathname: '/settle-up',
  params: {
    groupId,
    groupName,
    friendName: m.display_name,
    friendMemberId: m.id,
    amountCents: String(Math.abs(m.balance_cents)),
  },
})}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add app/group/balances.tsx
git commit -m "feat: pass friendMemberId to settle-up and refetch on focus"
```

---

### Task 6: Update `app/group/[id].tsx`

**Files:**
- Modify: `app/group/[id].tsx`

The group-level "Settle up" button currently navigates to `/settle-up` without a counterparty. Re-route it to `/group/balances` so the user selects which member to settle with.

- [ ] **Step 1: Find and update the Settle up button `onPress`**

Search for the existing `onPress` that navigates to `/settle-up` in `app/group/[id].tsx` (around line 244):

```ts
// Before:
onPress={() => router.push({ pathname: '/settle-up', params: { groupId: id, groupName: group.name, amountCents: String(group.balance_cents) } })}

// After:
onPress={() => router.push({ pathname: '/group/balances', params: { groupId: id, groupName: group.name } })}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/group/[id].tsx
git commit -m "feat: route group-level settle button to balances screen"
```

---

### Task 7: Update `app/(tabs)/activity.tsx`

**Files:**
- Modify: `app/(tabs)/activity.tsx`

Two changes: (a) add `payee_name` to `ActivityRow` interface, (b) add `SettlementCard` component and branch in `renderItem`.

- [ ] **Step 1: Add `payee_name` to the `ActivityRow` interface** (line ~39)

```ts
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
  payee_name?: string | null;   // ← add this line (optional — null for expense rows)
}
```

- [ ] **Step 2: Add `settlement` to `CATEGORY_ICONS`** (line ~30)

```ts
const CATEGORY_ICONS: Record<string, { icon: string; bg: string; color: string }> = {
  restaurant: { icon: 'restaurant', bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  hotel: { icon: 'hotel', bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
  train: { icon: 'train', bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
  store: { icon: 'local-convenience-store', bg: 'rgba(234,179,8,0.15)', color: '#eab308' },
  receipt: { icon: 'receipt-long', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
  payment: { icon: 'payments', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' },
  settlement: { icon: 'payments', bg: 'rgba(23,232,107,0.15)', color: '#17e86b' }, // ← add
};
```

- [ ] **Step 3: Add `SettlementCard` component after `ActivityCard` (before `ActivityScreen`)**

Insert the new component between the closing `}` of `ActivityCard` and the `export default function ActivityScreen()`:

```tsx
function SettlementCard({ item }: { item: ActivityRow }) {
  const { format } = useCurrency();
  const label = item.paid_by_is_user
    ? `You paid ${item.payee_name ?? 'someone'}`
    : `${item.paid_by_name ?? 'Someone'} paid you`;

  return (
    <Pressable style={({ pressed }: { pressed: boolean }) => [s.card, pressed && { opacity: 0.8 }]}>
      <View style={[s.iconBox, { backgroundColor: 'rgba(23,232,107,0.15)' }]}>
        <MaterialIcons name="payments" size={22} color="#17e86b" />
      </View>
      <View style={s.cardInfo}>
        <Text style={s.cardTitle} numberOfLines={1}>{label}</Text>
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
```

- [ ] **Step 4: Branch `renderItem` in `ActivityScreen` to use `SettlementCard` for settlements**

Find the `renderItem` prop on the `SectionList` (around line 171):

```tsx
// Before:
renderItem={({ item }: { item: ActivityRow }) => <ActivityCard item={item} />}

// After:
renderItem={({ item }: { item: ActivityRow }) =>
  item.category === 'settlement'
    ? <SettlementCard item={item} />
    : <ActivityCard item={item} />
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/(tabs)/activity.tsx
git commit -m "feat: render settlement rows distinctly in activity feed"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass — no regressions

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: 0 errors

- [ ] **Step 4: Manual smoke test (if device/simulator available)**

1. Open app → Group detail screen → tap "Settle up" → should navigate to Group Balances (not directly to settle-up)
2. Group Balances → tap "Settle up" on a member with a non-zero balance → should open settle-up screen with pre-filled amount and correct payee name
3. Edit the amount (try partial), tap "Save Payment" → should navigate back
4. Return to Group Balances → per-member balance for that member should be reduced
5. Home screen → group total balance should reflect the settlement
6. Activity tab → settlement should appear as "You paid [payee name]" with green amount
7. Friends tab → cross-group balance should reflect the settlement

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -p  # stage only intentional changes
git commit -m "chore: settle-up completion final cleanup"
```
