import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { useGroups } from '@/hooks/use-groups';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: { id: 'user-123' }, session: {}, loading: false }),
}));

beforeEach(() => jest.clearAllMocks());

const mockGroupRows = [
  {
    id: 'g1',
    name: 'Japan Trip',
    icon_name: 'flight',
    bg_color: '#1a3324',
    created_at: '2026-01-01T00:00:00Z',
    group_balances: [{ balance_cents: 5000 }],
    group_members: [{ user_id: 'user-123' }],
  },
  {
    id: 'g2',
    name: 'Roommates',
    icon_name: 'home',
    bg_color: '#244732',
    created_at: '2026-01-02T00:00:00Z',
    group_balances: [{ balance_cents: -2000 }],
    group_members: [{ user_id: 'user-123' }],
  },
];

describe('useGroups', () => {
  beforeEach(() => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: mockGroupRows, error: null }),
    });
  });

  it('returns groups after load', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups.length).toBe(2);
  });

  it('maps group names correctly', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    const names = result.current.groups.map((g) => g.name);
    expect(names).toContain('Japan Trip');
    expect(names).toContain('Roommates');
  });

  it('computes totalBalanceCents as sum of all group balances', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    // 5000 + (-2000) = 3000
    expect(result.current.totalBalanceCents).toBe(3000);
  });

  it('sets status "owed" for positive balance', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    const g = result.current.groups.find((x) => x.id === 'g1');
    expect(g?.status).toBe('owed');
  });

  it('sets status "owes" for negative balance', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    const g = result.current.groups.find((x) => x.id === 'g2');
    expect(g?.status).toBe('owes');
  });

  it('starts loading then sets loading false', async () => {
    const { result } = renderHook(() => useGroups());
    // loading may be true initially
    await act(async () => {});
    expect(result.current.loading).toBe(false);
  });

  it('returns empty groups on error', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });
});
