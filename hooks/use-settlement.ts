// hooks/use-settlement.ts
import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SettleParams {
  groupId: string;
  payeeMemberId: string;
  amountCents: number;
  paymentMethod: 'cash' | 'venmo' | 'other';
  note?: string;
  payerMemberId?: string; // if provided, this member pays the current user
}

export function useSettlement() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = useCallback(async (params: SettleParams): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('record_settlement', {
        p_group_id: params.groupId,
        p_payee_member_id: params.payeeMemberId,
        p_amount_cents: params.amountCents,
        p_payment_method: params.paymentMethod,
        p_note: params.note ?? null,
        p_payer_member_id: params.payerMemberId ?? null,
      });
      if (rpcErr) throw rpcErr;
      return true;
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : ((err as { message?: string })?.message ??
              'Failed to record settlement'),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { settle, loading, error };
}
