import { act, renderHook } from '@testing-library/react-native';
import { useFriends } from '@/hooks/use-friends';
import { supabase } from '@/lib/supabase';
import * as Contacts from 'expo-contacts';

jest.mock('@/lib/supabase');
jest.mock('expo-contacts');
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn().mockImplementation((_alg: string, value: string) =>
    Promise.resolve(`hash:${value}`)
  ),
}));
jest.mock('@/context/auth', () => {
  const user = { id: 'user-123' };
  return { useAuth: () => ({ user }) };
});

const mockContacts = [
  { name: 'Alice Smith', emails: [{ email: 'alice@example.com' }], phoneNumbers: [] },
  { name: 'Bob Jones', emails: [], phoneNumbers: [{ number: '4155559876' }] },
  { name: 'Charlie Brown', emails: [{ email: 'charlie@example.com' }], phoneNumbers: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  (Contacts.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: Contacts.PermissionStatus.GRANTED });
  (Contacts.getContactsAsync as jest.Mock).mockResolvedValue({ data: mockContacts });
  (supabase.rpc as jest.Mock).mockImplementation((fn: string) => {
    if (fn === 'match_contacts') return Promise.resolve({ data: [{ id: 'user-alice', name: 'Alice Smith', avatar_url: null }], error: null });
    if (fn === 'get_friend_balances') return Promise.resolve({ data: [{ user_id: 'user-alice', display_name: 'Alice Smith', avatar_url: null, balance_cents: 1500 }], error: null });
    if (fn === 'get_group_friends') return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: [], error: null });
  });
});

describe('useFriends', () => {
  it('sets permissionDenied when contacts permission is denied', async () => {
    (Contacts.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: Contacts.PermissionStatus.DENIED });
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(result.current.permissionDenied).toBe(true);
    expect(result.current.matched).toHaveLength(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('attaches balance to matched contacts', async () => {
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(result.current.matched).toHaveLength(1);
    expect(result.current.matched[0].userId).toBe('user-alice');
    expect(result.current.matched[0].balanceCents).toBe(1500);
    expect(result.current.matched[0].balanceStatus).toBe('owed');
    // phone numbers sent as plain text; phone_hash array must be empty
    expect(supabase.rpc).toHaveBeenCalledWith('match_contacts', expect.objectContaining({
      p_phone_hashes: [],
      p_phones: expect.arrayContaining(['+14155559876']),
    }));
  });

  it('sets balanceStatus to no_groups when matched contact has no balance row', async () => {
    (supabase.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'match_contacts') return Promise.resolve({ data: [{ id: 'user-alice', name: 'Alice Smith', avatar_url: null }], error: null });
      if (fn === 'get_friend_balances') return Promise.resolve({ data: [], error: null });
      if (fn === 'get_group_friends') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(result.current.matched[0].balanceStatus).toBe('no_groups');
    expect(result.current.matched[0].balanceCents).toBe(0);
  });

  it('sets error when match_contacts RPC fails', async () => {
    (supabase.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'match_contacts') return Promise.resolve({ data: null, error: { message: 'RPC error' } });
      if (fn === 'get_group_friends') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(result.current.error).toBe('RPC error');
  });

  it('refetch re-runs permission check', async () => {
    const { result } = renderHook(() => useFriends());
    await act(async () => {}); // let mount effect settle
    jest.clearAllMocks();      // reset counts after auto-run
    await act(async () => { await result.current.refetch(); });
    await act(async () => { await result.current.refetch(); });
    expect(Contacts.requestPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  it('merges group co-members not in contacts into matched list', async () => {
    (supabase.rpc as jest.Mock).mockImplementation((fn: string) => {
      if (fn === 'match_contacts') return Promise.resolve({ data: [], error: null });
      if (fn === 'get_friend_balances') return Promise.resolve({ data: [], error: null });
      if (fn === 'get_group_friends') return Promise.resolve({
        data: [{ user_id: 'user-dave', name: 'Dave Green', avatar_url: null }],
        error: null,
      });
      return Promise.resolve({ data: [], error: null });
    });
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(result.current.matched).toHaveLength(1);
    expect(result.current.matched[0].userId).toBe('user-dave');
    expect(result.current.matched[0].balanceStatus).toBe('no_groups');
  });

  it('skips RPC when no emails or phones in contacts', async () => {
    (Contacts.getContactsAsync as jest.Mock).mockResolvedValue({ data: [{ name: 'No Contact Info' }] });
    const { result } = renderHook(() => useFriends());
    await act(async () => { await result.current.refetch(); });
    expect(supabase.rpc).not.toHaveBeenCalledWith('match_contacts', expect.anything());
    expect(result.current.unmatched).toHaveLength(1);
  });
});
