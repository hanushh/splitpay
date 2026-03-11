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
      eq: jest.fn().mockReturnThis(),
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
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });

  it('sets status "settled" for zero balance', async () => {
    const settledRow = [
      {
        id: 'g3',
        name: 'Settled Group',
        icon_name: 'group',
        bg_color: '#1a3324',
        created_at: '2026-01-03T00:00:00Z',
        group_balances: [{ balance_cents: 0 }],
        group_members: [{ user_id: 'user-123' }],
      },
    ];
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: settledRow, error: null }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups[0].status).toBe('settled');
    expect(result.current.groups[0].balance_cents).toBe(0);
  });

  it('defaults balance_cents to 0 when group_balances is empty', async () => {
    const noBalanceRow = [
      {
        id: 'g4',
        name: 'No Balance Group',
        icon_name: 'group',
        bg_color: null,
        created_at: '2026-01-04T00:00:00Z',
        group_balances: [],
        group_members: [{ user_id: 'user-123' }],
      },
    ];
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: noBalanceRow, error: null }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups[0].balance_cents).toBe(0);
    expect(result.current.groups[0].status).toBe('settled');
  });

  it('uses default bg_color when group bg_color is null', async () => {
    const nullColorRow = [
      {
        id: 'g5',
        name: 'No Color Group',
        icon_name: null,
        bg_color: null,
        archived: null,
        created_at: '2026-01-05T00:00:00Z',
        group_balances: [{ balance_cents: 100 }],
        group_members: [{ user_id: 'user-123' }],
      },
    ];
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: nullColorRow, error: null }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups[0].bg_color).toBe('rgba(99,102,241,0.25)');
    expect(result.current.groups[0].archived).toBe(false);
  });

  it('includes members with different user_id and avatar_url', async () => {
    const rowWithMembers = [
      {
        id: 'g6',
        name: 'Group With Members',
        icon_name: 'group',
        bg_color: '#1a3324',
        created_at: '2026-01-06T00:00:00Z',
        group_balances: [{ balance_cents: 1000 }],
        group_members: [
          { user_id: 'user-123', display_name: 'Me', avatar_url: null },
          { user_id: 'other-user', display_name: 'Alice', avatar_url: 'https://example.com/alice.jpg' },
          { user_id: 'another-user', display_name: 'Bob', avatar_url: null },
        ],
      },
    ];
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: rowWithMembers, error: null }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    // Only Alice passes both filters (different user_id AND has avatar_url)
    expect(result.current.groups[0].members).toHaveLength(1);
    expect(result.current.groups[0].members[0].display_name).toBe('Alice');
  });

  it('refetch re-fetches groups from Supabase', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(result.current.groups).toHaveLength(2);

    const updatedRows = [mockGroupRows[0]];
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: updatedRows, error: null }),
    });

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.groups).toHaveLength(1);
  });

  it('initializes demo data on first load', async () => {
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(supabase.rpc).toHaveBeenCalledWith('initialize_demo_data', { p_user_id: 'user-123' });
    expect(result.current.groups).toHaveLength(2);
  });

  it('excludes archived groups from results', async () => {
    const activeGroupRow = {
      id: 'g1',
      name: 'Active Group',
      icon_name: 'group',
      bg_color: '#1a3324',
      archived: false,
      created_at: '2026-01-01T00:00:00Z',
      group_balances: [{ balance_cents: 1000 }],
      group_members: [{ user_id: 'user-123' }],
    };
    const eqMock = jest.fn().mockReturnThis();
    (supabase.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: eqMock,
      order: jest.fn().mockResolvedValue({ data: [activeGroupRow], error: null }),
    });
    const { result } = renderHook(() => useGroups());
    await act(async () => {});
    expect(eqMock).toHaveBeenCalledWith('archived', false);
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].name).toBe('Active Group');
  });
});
