import { act, renderHook } from '@testing-library/react-native';
import { useCategoryCache } from '@/hooks/use-category-cache';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/lib/supabase');
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}));

const mockRows = [
  { keyword: 'yoga', category: 'health', usage_count: 5 },
  { keyword: 'gym', category: 'health', usage_count: 3 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage as any).__store = {};
  (supabase.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: mockRows, error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    update: jest.fn().mockResolvedValue({ error: null }),
  });
  (supabase.rpc as jest.Mock) = jest.fn().mockResolvedValue({ error: null });
});

describe('useCategoryCache', () => {
  it('loads learned mappings from Supabase on mount', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});
    // yoga and gym loaded — detect should use them
    const category = result.current.detect('yoga class fee');
    expect(category).toBe('health');
  });

  it('falls back to built-in dict when no learned match', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});
    expect(result.current.detect('uber ride home')).toBe('train');
  });

  it('returns "other" when no match found', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});
    expect(result.current.detect('xyz foobar')).toBe('other');
  });

  it('saveMapping calls increment_keyword_usage RPC and updates in-memory cache', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    await act(async () => {
      await result.current.saveMapping('pilates class', 'fitness');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('increment_keyword_usage', {
      p_keywords: expect.arrayContaining(['pilates']),
      p_category: 'fitness',
    });

    // In-memory cache updated — next detect should use it
    expect(result.current.detect('pilates session')).toBe('fitness');
  });

  it('writes cache to AsyncStorage after fetch', async () => {
    renderHook(() => useCategoryCache());
    await act(async () => {});
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@category_cache_v1',
      expect.any(String),
    );
  });

  it('reinforceMapping calls increment_keyword_usage RPC for learned keywords', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    await act(async () => {
      await result.current.reinforceMapping('yoga class fee', 'health');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('increment_keyword_usage', {
      p_keywords: expect.arrayContaining(['yoga']),
      p_category: 'health',
    });
  });

  it('reinforceMapping calls RPC for built-in keywords (no pre-existing learned entry required)', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    // 'uber' is in KEYWORD_DICT → 'train' but NOT in learned cache
    await act(async () => {
      await result.current.reinforceMapping('uber ride', 'train');
    });

    expect(supabase.rpc).toHaveBeenCalledWith('increment_keyword_usage', {
      p_keywords: expect.arrayContaining(['uber']),
      p_category: 'train',
    });
  });
});
