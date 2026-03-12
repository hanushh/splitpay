import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGroups } from '@/hooks/use-groups';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('@/context/auth', () => {
  const user = { id: 'user-123' };
  return {
    useAuth: () => ({ user, session: {}, loading: false }),
  };
});

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

const defaultMembershipData = [{ group_id: 'g1' }, { group_id: 'g2' }];

/**
 * Build a supabase.from mock that handles both steps of the two-step fetch:
 *  1. group_members → resolve with membership rows
 *  2. groups        → resolve with group rows (via select→in→eq→order chain)
 */
function makeFromMock(
  groupRows: object[] | null,
  groupsError: { message: string } | null = null,
  membershipData = defaultMembershipData,
  groupsEqMock?: jest.Mock,
) {
  return (table: string) => {
    if (table === 'group_members') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: membershipData, error: null }),
      };
    }
    // table === 'groups'
    return {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      eq: groupsEqMock ?? jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: groupRows, error: groupsError }),
    };
  };
}

describe('useGroups', () => {
  beforeEach(() => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
    (supabase.from as jest.Mock).mockImplementation(makeFromMock(mockGroupRows));
  });

  it('returns groups after load', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.length).toBe(2);
  });

  it('maps group names correctly', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const names = result.current.groups.map((g) => g.name);
    expect(names).toContain('Japan Trip');
    expect(names).toContain('Roommates');
  });

  it('computes totalBalanceCents as sum of all group balances', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // 5000 + (-2000) = 3000
    expect(result.current.totalBalanceCents).toBe(3000);
  });

  it('sets status "owed" for positive balance', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const g = result.current.groups.find((x) => x.id === 'g1');
    expect(g?.status).toBe('owed');
  });

  it('sets status "owes" for negative balance', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const g = result.current.groups.find((x) => x.id === 'g2');
    expect(g?.status).toBe('owes');
  });

  it('starts loading then sets loading false', async () => {
    const { result } = renderHook(() => useGroups());
    // loading may be true initially
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loading).toBe(false);
  });

  it('returns empty groups on error', async () => {
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(null, { message: 'DB error' }),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
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
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(settledRow, null, [{ group_id: 'g3' }]),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
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
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(noBalanceRow, null, [{ group_id: 'g4' }]),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
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
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(nullColorRow, null, [{ group_id: 'g5' }]),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
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
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(rowWithMembers, null, [{ group_id: 'g6' }]),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only Alice passes both filters (different user_id AND has avatar_url)
    expect(result.current.groups[0].members).toHaveLength(1);
    expect(result.current.groups[0].members[0].display_name).toBe('Alice');
  });

  it('refetch re-fetches groups from Supabase', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(2);

    const updatedRows = [mockGroupRows[0]];
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock(updatedRows, null, [{ group_id: 'g1' }]),
    );

    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
  });

  it('fetches groups on first load without seeding demo data', async () => {
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(supabase.rpc).not.toHaveBeenCalledWith('initialize_demo_data', expect.anything());
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
    (supabase.from as jest.Mock).mockImplementation(
      makeFromMock([activeGroupRow], null, [{ group_id: 'g1' }], eqMock),
    );
    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(eqMock).toHaveBeenCalledWith('archived', false);
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.groups[0].name).toBe('Active Group');
  });
});
