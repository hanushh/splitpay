import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringExpense {
  id: string;
  group_id: string;
  description: string;
  amount_cents: number;
  currency_code: string;
  category: string;
  paid_by_member_id: string | null;
  frequency: RecurringFrequency;
  next_occurrence_date: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRecurringExpenseParams {
  groupId: string;
  description: string;
  amountCents: number;
  currencyCode: string;
  category: string;
  paidByMemberId: string | null;
  frequency: RecurringFrequency;
  nextOccurrenceDate: string;
}

function nextDateForFrequency(from: string, frequency: RecurringFrequency): string {
  const d = new Date(from);
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().split('T')[0];
}

export function useRecurringPayments(groupId: string) {
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecurringExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('recurring_expenses')
        .select('*')
        .eq('group_id', groupId)
        .eq('active', true)
        .order('next_occurrence_date', { ascending: true });
      if (fetchErr) throw fetchErr;
      setRecurringExpenses((data as RecurringExpense[]) ?? []);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to load recurring expenses',
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const createRecurringExpense = useCallback(
    async (params: CreateRecurringExpenseParams): Promise<boolean> => {
      setError(null);
      try {
        const { error: insertErr } = await supabase
          .from('recurring_expenses')
          .insert({
            group_id: params.groupId,
            description: params.description,
            amount_cents: params.amountCents,
            currency_code: params.currencyCode,
            category: params.category,
            paid_by_member_id: params.paidByMemberId,
            frequency: params.frequency,
            next_occurrence_date: params.nextOccurrenceDate,
            active: true,
          });
        if (insertErr) throw insertErr;
        await fetchRecurringExpenses();
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : 'Failed to create recurring expense',
        );
        return false;
      }
    },
    [fetchRecurringExpenses],
  );

  const triggerNow = useCallback(
    async (item: RecurringExpense): Promise<boolean> => {
      setError(null);
      try {
        // Fetch group members for equal split
        const { data: membersData, error: membersErr } = await supabase
          .from('group_members')
          .select('id')
          .eq('group_id', item.group_id);
        if (membersErr) throw membersErr;

        const members = (membersData ?? []) as { id: string }[];
        const memberIds = members.map((m) => m.id);

        const { error: rpcErr } = await supabase.rpc('create_expense_with_splits', {
          p_group_id: item.group_id,
          p_description: item.description,
          p_amount_cents: item.amount_cents,
          p_paid_by_member_id: item.paid_by_member_id,
          p_category: item.category,
          p_currency_code: item.currency_code,
          p_receipt_url: null,
          p_split_member_ids: memberIds,
        });
        if (rpcErr) throw rpcErr;

        // Advance next occurrence date
        const newNextDate = nextDateForFrequency(item.next_occurrence_date, item.frequency);
        const { error: updateErr } = await supabase
          .from('recurring_expenses')
          .update({ next_occurrence_date: newNextDate })
          .eq('id', item.id);
        if (updateErr) throw updateErr;

        await fetchRecurringExpenses();
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : 'Failed to add expense',
        );
        return false;
      }
    },
    [fetchRecurringExpenses],
  );

  const deleteRecurringExpense = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        const { error: deleteErr } = await supabase
          .from('recurring_expenses')
          .delete()
          .eq('id', id);
        if (deleteErr) throw deleteErr;
        setRecurringExpenses((prev) => prev.filter((r) => r.id !== id));
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : 'Failed to delete recurring expense',
        );
        return false;
      }
    },
    [],
  );

  return {
    recurringExpenses,
    loading,
    error,
    fetchRecurringExpenses,
    createRecurringExpense,
    triggerNow,
    deleteRecurringExpense,
  };
}
