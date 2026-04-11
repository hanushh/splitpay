import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  extractKeywords,
  scoreDescription,
  KEYWORD_DICT,
} from '@/lib/category-keywords';

const CACHE_KEY = '@category_cache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_LIMIT = 3000;

interface CachePayload {
  mappings: Record<string, Record<string, number>>;
  fetched_at: number;
}

/** Singleton in-memory cache shared across all hook instances. */
let inMemory: Record<string, Record<string, number>> = {};
let fetchedAt = 0;

async function loadCache(): Promise<CachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachePayload) : null;
  } catch {
    return null;
  }
}

async function writeCache(mappings: Record<string, Record<string, number>>) {
  const payload: CachePayload = { mappings, fetched_at: Date.now() };
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

async function fetchFromSupabase(): Promise<
  Record<string, Record<string, number>>
> {
  const { data, error } = await supabase
    .from('category_keyword_mappings')
    .select('keyword, category, usage_count')
    .order('usage_count', { ascending: false })
    .limit(FETCH_LIMIT);

  if (error || !data) return {};

  const mappings: Record<string, Record<string, number>> = {};
  for (const row of data as {
    keyword: string;
    category: string;
    usage_count: number;
  }[]) {
    if (!mappings[row.keyword]) mappings[row.keyword] = {};
    mappings[row.keyword][row.category] = row.usage_count;
  }
  return mappings;
}

export function useCategoryCache() {
  const [userId, setUserId] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setUserId(data.session?.user?.id ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId || initialized.current) return;
    initialized.current = true;

    (async () => {
      const cached = await loadCache();
      // fetchedAt === 0 means never fetched in this app session (e.g. fresh launch or after logout)
      const sessionNeverFetched = fetchedAt === 0;
      const isStale =
        !cached ||
        sessionNeverFetched ||
        Date.now() - cached.fetched_at > CACHE_TTL_MS;

      if (!isStale && cached) {
        inMemory = cached.mappings;
        fetchedAt = cached.fetched_at;
        return;
      }

      const fresh = await fetchFromSupabase();
      inMemory = fresh;
      fetchedAt = Date.now();
      await writeCache(fresh);
    })();
  }, [userId]);

  /**
   * Synchronous — reads from in-memory cache. Zero latency.
   * Triggers a background re-fetch if cache is stale (>24h).
   */
  const detect = useCallback(
    (description: string): string => {
      // Background re-fetch if stale — does not block the synchronous return
      if (userId && Date.now() - fetchedAt > CACHE_TTL_MS) {
        fetchFromSupabase()
          .then((fresh) => {
            inMemory = fresh;
            fetchedAt = Date.now();
            writeCache(fresh);
          })
          .catch(() => {});
      }
      const keywords = extractKeywords(description);
      return scoreDescription(keywords, inMemory);
    },
    [userId],
  );

  /**
   * Called when user manually enters a custom category for "other".
   * Atomically increments usage_count server-side; updates in-memory cache.
   */
  const saveMapping = useCallback(
    async (description: string, category: string) => {
      const keywords = extractKeywords(description);
      if (keywords.length === 0) return;

      // Atomic server-side upsert+increment — avoids race conditions
      const { error } = await supabase.rpc('increment_keyword_usage', {
        p_keywords: keywords,
        p_category: category,
      });
      if (error) {
        console.warn('[CategoryCache] saveMapping RPC error:', error.message);
        return;
      }

      // Merge into in-memory cache optimistically
      for (const keyword of keywords) {
        if (!inMemory[keyword]) inMemory[keyword] = {};
        inMemory[keyword][category] = (inMemory[keyword][category] ?? 0) + 1;
      }
    },
    [],
  );

  /**
   * Called when auto-detection succeeds and user saves the expense.
   * Reinforces all keywords that contributed to this category (built-in or learned).
   */
  const reinforceMapping = useCallback(
    async (description: string, category: string) => {
      const keywords = extractKeywords(description).filter(
        (kw) =>
          KEYWORD_DICT[kw] === category ||
          inMemory[kw]?.[category] !== undefined,
      );
      if (keywords.length === 0) return;

      // Atomic server-side increment
      const { error } = await supabase.rpc('increment_keyword_usage', {
        p_keywords: keywords,
        p_category: category,
      });
      if (error) {
        console.warn(
          '[CategoryCache] reinforceMapping RPC error:',
          error.message,
        );
        return;
      }

      // Update in-memory cache optimistically
      for (const keyword of keywords) {
        if (!inMemory[keyword]) inMemory[keyword] = {};
        inMemory[keyword][category] = (inMemory[keyword][category] ?? 0) + 1;
      }
    },
    [],
  );

  return { detect, saveMapping, reinforceMapping };
}

/** Call on logout to clear the local cache. */
export async function clearCategoryCache() {
  inMemory = {};
  fetchedAt = 0;
  await AsyncStorage.removeItem(CACHE_KEY);
}

/** For testing only — resets in-memory singleton state between tests. */
export function __resetCacheForTesting(): void {
  inMemory = {};
  fetchedAt = 0;
}
