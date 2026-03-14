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
