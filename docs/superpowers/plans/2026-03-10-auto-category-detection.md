# Auto Category Detection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual 6-button category picker in Add Expense with intelligent auto-detection driven by a built-in keyword dictionary and a shared Supabase learning table, displaying the result as a read-only chip and showing a text input only when the category falls back to "other".

**Architecture:** Pure keyword-extraction and scoring logic lives in `lib/category-keywords.ts` (no React, no I/O — fully unit-testable). A React hook `hooks/use-category-cache.ts` wraps that logic with a Supabase-backed, AsyncStorage-cached learned-mapping table. `app/add-expense.tsx` is modified to consume the hook and replace the category grid.

**Tech Stack:** React Native, Supabase JS client, `@react-native-async-storage/async-storage`, Jest

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260310000000_create_category_keyword_mappings.sql` | **Create** | DB table, RLS policies, index |
| `lib/category-keywords.ts` | **Create** | STOP_WORDS, KEYWORD_DICT, extractKeywords(), scoreDescription() |
| `hooks/use-category-cache.ts` | **Create** | Cache lifecycle, detect(), saveMapping(), reinforceMapping() |
| `__tests__/lib/category-keywords.test.ts` | **Create** | Unit tests for all pure functions |
| `__tests__/hooks/use-category-cache.test.ts` | **Create** | Hook integration tests |
| `__mocks__/@react-native-async-storage/async-storage.ts` | **Create** | Jest mock for AsyncStorage |
| `app/add-expense.tsx` | **Modify** | Remove category grid; add chip + conditional text input; wire hook |

---

## Chunk 1: DB Migration + Pure Logic

### Task 1: Install dependency

- [ ] **Step 1: Install AsyncStorage**

```bash
pnpm add @react-native-async-storage/async-storage
```

Expected: package appears in `package.json` dependencies.

- [ ] **Step 2: Create Jest mock**

Create the directory first, then the mock file:

```bash
mkdir -p __mocks__/@react-native-async-storage
```

Create `__mocks__/@react-native-async-storage/async-storage.ts`:

```ts
const store: Record<string, string> = {};

export default {
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete store[key]; }),
  clear: jest.fn(async () => { Object.keys(store).forEach(k => delete store[k]); }),
  __store: store,
};
```

- [ ] **Step 3: Add moduleNameMapper entry in jest.config.js**

```js
// add to moduleNameMapper:
'^@react-native-async-storage/async-storage$':
  '<rootDir>/__mocks__/@react-native-async-storage/async-storage.ts',
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml jest.config.js __mocks__/@react-native-async-storage/
git commit -m "feat: add AsyncStorage dependency and jest mock"
```

---

### Task 2: DB Migration

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260310000000_create_category_keyword_mappings.sql`:

```sql
-- Create shared keyword → category mapping table
CREATE TABLE IF NOT EXISTS public.category_keyword_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword      text NOT NULL,
  category     text NOT NULL,
  usage_count  integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_keyword_mappings_unique UNIQUE (keyword, category)
);

-- Index for cache fetch (ORDER BY usage_count DESC LIMIT 3000)
CREATE INDEX IF NOT EXISTS idx_category_keyword_mappings_usage
  ON public.category_keyword_mappings (usage_count DESC);

-- RLS
ALTER TABLE public.category_keyword_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all_mappings"
  ON public.category_keyword_mappings FOR SELECT
  USING (true);

CREATE POLICY "authenticated_insert"
  ON public.category_keyword_mappings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "authenticated_update"
  ON public.category_keyword_mappings FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Atomic server-side increment function (avoids client-side race conditions)
CREATE OR REPLACE FUNCTION public.increment_keyword_usage(
  p_keywords text[],
  p_category text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.category_keyword_mappings (keyword, category, usage_count)
  SELECT unnest(p_keywords), p_category, 1
  ON CONFLICT (keyword, category)
  DO UPDATE SET usage_count = category_keyword_mappings.usage_count + 1;
$$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with project ID `yapfqffhgcncqxovjcsr`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260310000000_create_category_keyword_mappings.sql
git commit -m "feat: add category_keyword_mappings table with RLS"
```

---

### Task 3: Pure logic — write failing tests first

- [ ] **Step 1: Create test file**

Create `__tests__/lib/category-keywords.test.ts`:

```ts
import {
  extractKeywords,
  scoreDescription,
  KEYWORD_DICT,
} from '@/lib/category-keywords';

describe('extractKeywords', () => {
  it('lowercases and splits on whitespace', () => {
    expect(extractKeywords('Dinner at Zomato')).toEqual(
      expect.arrayContaining(['dinner', 'zomato'])
    );
  });

  it('removes stop words', () => {
    const result = extractKeywords('lunch at the cafe');
    expect(result).not.toContain('at');
    expect(result).not.toContain('the');
    expect(result).toContain('lunch');
    expect(result).toContain('cafe');
  });

  it('strips punctuation', () => {
    expect(extractKeywords("McDonald's dinner")).toContain('mcdonalds');
  });

  it('drops tokens shorter than 3 chars', () => {
    expect(extractKeywords('go to bus')).not.toContain('go');
    expect(extractKeywords('go to bus')).toContain('bus');
  });

  it('returns empty array for stop-word-only input', () => {
    expect(extractKeywords('at the')).toEqual([]);
  });
});

describe('scoreDescription', () => {
  it('returns "other" when no keywords match', () => {
    expect(scoreDescription(['xyzzy', 'foobar'], {})).toBe('other');
  });

  it('picks built-in category for known keyword', () => {
    expect(scoreDescription(['uber'], {})).toBe('train');
  });

  it('picks learned category when it outscores built-in', () => {
    // 'dinner' built-in = restaurant (+10)
    // learned 'dinner' → 'other:health' with count 50 wins
    const learned = { dinner: { 'other:health': 50 } };
    expect(scoreDescription(['dinner'], learned)).toBe('other:health');
  });

  it('built-in wins on tie', () => {
    // built-in gives 'restaurant' +10 via 'dinner'
    // learned gives 'restaurant' +10 via 'dinner' — tie → built-in wins
    const learned = { dinner: { restaurant: 10 } };
    expect(scoreDescription(['dinner'], learned)).toBe('restaurant');
  });

  it('accumulates scores across multiple keywords', () => {
    // 'uber' → train (+10), 'taxi' → train (+10) → train total 20
    // 'dinner' → restaurant (+10) → restaurant total 10
    expect(scoreDescription(['uber', 'taxi', 'dinner'], {})).toBe('train');
  });

  it('returns "other" for empty keywords array', () => {
    expect(scoreDescription([], {})).toBe('other');
  });
});

describe('KEYWORD_DICT', () => {
  it('maps common transport words', () => {
    expect(KEYWORD_DICT['uber']).toBe('train');
    expect(KEYWORD_DICT['taxi']).toBe('train');
  });

  it('maps common food words', () => {
    expect(KEYWORD_DICT['dinner']).toBe('restaurant');
    expect(KEYWORD_DICT['pizza']).toBe('restaurant');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- __tests__/lib/category-keywords.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/category-keywords'`

---

### Task 4: Implement pure logic

- [ ] **Step 1: Create `lib/category-keywords.ts`**

```ts
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'in', 'at', 'on',
  'with', 'and', 'or', 'by', 'of', 'from', 'my', 'our',
]);

export const KEYWORD_DICT: Record<string, string> = {
  // Food & Drink
  dinner: 'restaurant', lunch: 'restaurant', breakfast: 'restaurant',
  coffee: 'restaurant', cafe: 'restaurant', zomato: 'restaurant',
  swiggy: 'restaurant', mcdonalds: 'restaurant', restaurant: 'restaurant',
  food: 'restaurant', pizza: 'restaurant', burger: 'restaurant',
  biryani: 'restaurant', snack: 'restaurant', drinks: 'restaurant',
  // Transport
  uber: 'train', ola: 'train', taxi: 'train', metro: 'train',
  bus: 'train', train: 'train', flight: 'train', fuel: 'train',
  petrol: 'train', toll: 'train', rapido: 'train', cab: 'train',
  // Accommodation
  hotel: 'hotel', airbnb: 'hotel', hostel: 'hotel', rent: 'hotel',
  accommodation: 'hotel', lodge: 'hotel', stay: 'hotel',
  // Entertainment
  netflix: 'movie', movie: 'movie', cinema: 'movie', concert: 'movie',
  spotify: 'movie', ticket: 'movie', show: 'movie', game: 'movie',
  // Shopping
  amazon: 'store', flipkart: 'store', grocery: 'store', groceries: 'store',
  walmart: 'store', mall: 'store', shopping: 'store', market: 'store',
  supermarket: 'store',
};

/** Score built-in matches — high enough to beat low-frequency learned entries. */
export const BUILTIN_SCORE = 10;

/**
 * Extract meaningful keywords from a raw expense description.
 * Lowercases, splits on non-alphanumeric, strips stop-words and short tokens.
 */
export function extractKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .split(/[\s.,\-()'"/\\:;!?]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Score extracted keywords against built-in dict and learned mappings.
 * Returns the winning category key, or "other" if nothing matches.
 */
export function scoreDescription(
  keywords: string[],
  learnedMappings: Record<string, Record<string, number>>,
): string {
  const scores: Record<string, number> = {};

  for (const keyword of keywords) {
    const builtinCategory = KEYWORD_DICT[keyword];
    if (builtinCategory) {
      scores[builtinCategory] = (scores[builtinCategory] ?? 0) + BUILTIN_SCORE;
    }
    const learned = learnedMappings[keyword];
    if (learned) {
      for (const [category, count] of Object.entries(learned)) {
        scores[category] = (scores[category] ?? 0) + count;
      }
    }
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) return 'other';

  const builtinCategories = new Set(Object.values(KEYWORD_DICT));

  return entries.sort(([catA, scoreA], [catB, scoreB]) => {
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Tie-break: built-in category wins over learned
    return (builtinCategories.has(catB) ? 1 : 0) - (builtinCategories.has(catA) ? 1 : 0);
  })[0][0];
}
```

- [ ] **Step 2: Run tests — must pass**

```bash
npm test -- __tests__/lib/category-keywords.test.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/category-keywords.ts __tests__/lib/category-keywords.test.ts
git commit -m "feat: add category keyword dict and detection algorithm"
```

---

## Chunk 2: Cache Hook + UI

### Task 5: Cache hook — write failing tests first

- [ ] **Step 1: Create test file**

Create `__tests__/hooks/use-category-cache.test.ts`:

```ts
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

  it('saveMapping upserts keywords to Supabase and updates in-memory cache', async () => {
    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    await act(async () => {
      await result.current.saveMapping('pilates class', 'fitness');
    });

    const upsertMock = (supabase.from as jest.Mock)().upsert;
    expect(upsertMock).toHaveBeenCalled();
    const args = upsertMock.mock.calls[0][0] as { keyword: string; category: string }[];
    expect(args.some((r) => r.keyword === 'pilates' && r.category === 'fitness')).toBe(true);

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
    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    (supabase.rpc as jest.Mock) = rpcMock;

    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    await act(async () => {
      await result.current.reinforceMapping('yoga class fee', 'health');
    });

    expect(rpcMock).toHaveBeenCalledWith('increment_keyword_usage', {
      p_keywords: expect.arrayContaining(['yoga']),
      p_category: 'health',
    });
  });

  it('reinforceMapping calls RPC for built-in keywords (no pre-existing learned entry required)', async () => {
    const rpcMock = jest.fn().mockResolvedValue({ error: null });
    (supabase.rpc as jest.Mock) = rpcMock;

    const { result } = renderHook(() => useCategoryCache());
    await act(async () => {});

    // 'uber' is in KEYWORD_DICT → 'train' but NOT in learned cache
    await act(async () => {
      await result.current.reinforceMapping('uber ride', 'train');
    });

    expect(rpcMock).toHaveBeenCalledWith('increment_keyword_usage', {
      p_keywords: expect.arrayContaining(['uber']),
      p_category: 'train',
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- __tests__/hooks/use-category-cache.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/hooks/use-category-cache'`

---

### Task 6: Implement the cache hook

- [ ] **Step 1: Create `hooks/use-category-cache.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';
import { extractKeywords, scoreDescription, KEYWORD_DICT } from '@/lib/category-keywords';

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

async function fetchFromSupabase(): Promise<Record<string, Record<string, number>>> {
  const { data, error } = await supabase
    .from('category_keyword_mappings')
    .select('keyword, category, usage_count')
    .order('usage_count', { ascending: false })
    .limit(FETCH_LIMIT);

  if (error || !data) return {};

  const mappings: Record<string, Record<string, number>> = {};
  for (const row of data as { keyword: string; category: string; usage_count: number }[]) {
    if (!mappings[row.keyword]) mappings[row.keyword] = {};
    mappings[row.keyword][row.category] = row.usage_count;
  }
  return mappings;
}

export function useCategoryCache() {
  const { user } = useAuth();
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    initialized.current = true;

    (async () => {
      const cached = await loadCache();
      const isStale = !cached || Date.now() - cached.fetched_at > CACHE_TTL_MS;

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
  }, [user]);

  /**
   * Synchronous — reads from in-memory cache. Zero latency.
   * Triggers a background re-fetch if cache is stale (>24h).
   */
  const detect = useCallback((description: string): string => {
    // Background re-fetch if stale — does not block the synchronous return
    if (user && Date.now() - fetchedAt > CACHE_TTL_MS) {
      fetchFromSupabase().then((fresh) => {
        inMemory = fresh;
        fetchedAt = Date.now();
        writeCache(fresh);
      });
    }
    const keywords = extractKeywords(description);
    return scoreDescription(keywords, inMemory);
  }, [user]);

  /**
   * Called when user manually enters a custom category for "other".
   * Atomically increments usage_count server-side; updates in-memory cache.
   */
  const saveMapping = useCallback(async (description: string, category: string) => {
    const keywords = extractKeywords(description);
    if (keywords.length === 0) return;

    // Atomic server-side upsert+increment — avoids race conditions
    await supabase.rpc('increment_keyword_usage', {
      p_keywords: keywords,
      p_category: category,
    });

    // Merge into in-memory cache optimistically
    for (const keyword of keywords) {
      if (!inMemory[keyword]) inMemory[keyword] = {};
      inMemory[keyword][category] = (inMemory[keyword][category] ?? 0) + 1;
    }
  }, []);

  /**
   * Called when auto-detection succeeds and user saves the expense.
   * Reinforces all keywords that contributed to this category (built-in or learned).
   */
  const reinforceMapping = useCallback(async (description: string, category: string) => {
    const keywords = extractKeywords(description).filter(
      (kw) => KEYWORD_DICT[kw] === category || inMemory[kw]?.[category] !== undefined,
    );
    if (keywords.length === 0) return;

    // Atomic server-side increment
    await supabase.rpc('increment_keyword_usage', {
      p_keywords: keywords,
      p_category: category,
    });

    // Update in-memory cache optimistically
    for (const keyword of keywords) {
      if (!inMemory[keyword]) inMemory[keyword] = {};
      inMemory[keyword][category] = (inMemory[keyword][category] ?? 0) + 1;
    }
  }, []);

  return { detect, saveMapping, reinforceMapping };
}

/** Call on logout to clear the local cache. */
export async function clearCategoryCache() {
  inMemory = {};
  fetchedAt = 0;
  await AsyncStorage.removeItem(CACHE_KEY);
}
```

- [ ] **Step 2: Run tests — must pass**

```bash
npm test -- __tests__/hooks/use-category-cache.test.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add hooks/use-category-cache.ts __tests__/hooks/use-category-cache.test.ts
git commit -m "feat: add category cache hook with Supabase-backed learning"
```

---

### Task 7: Wire logout cache clear

- [ ] **Step 1: Update `context/auth.tsx` to clear cache on sign-out**

In `context/auth.tsx`, import and call `clearCategoryCache` in the `signOut` function:

```ts
// Add import at top:
import { clearCategoryCache } from '@/hooks/use-category-cache';

// Inside signOut():
const signOut = async () => {
  await clearCategoryCache();          // ← add this line before supabase.auth.signOut
  await removePushToken(activePushToken.current);
  await supabase.auth.signOut();
};
```

- [ ] **Step 2: Run full test suite**

```bash
npm test --no-coverage
```

Expected: all tests pass, no regressions.

- [ ] **Step 3: Commit**

```bash
git add context/auth.tsx
git commit -m "feat: clear category cache on logout"
```

---

### Task 8: UI — update add-expense screen

- [ ] **Step 1: Read current `app/add-expense.tsx`** to understand the exact blocks being removed/replaced before editing.

- [ ] **Step 2: Remove the CATEGORIES constant and category state, add hook and new state**

In `app/add-expense.tsx`:

```ts
// Remove:
// const CATEGORIES = [...] as const;
// const [category, setCategory] = useState<string>('other');

// Add at top of imports:
import { useCategoryCache } from '@/hooks/use-category-cache';

// Replace category state inside component:
const { detect, saveMapping, reinforceMapping } = useCategoryCache();
const [detectedCategory, setDetectedCategory] = useState<string>('other');
const [customCategory, setCustomCategory] = useState<string>('');
```

- [ ] **Step 3: Add debounced detection effect**

Add after the existing `useEffect` for `groupId`:

```ts
// Auto-detect category from description with 300ms debounce
useEffect(() => {
  if (!description.trim()) {
    setDetectedCategory('other');
    return;
  }
  const timer = setTimeout(() => {
    setDetectedCategory(detect(description));
  }, 300);
  return () => clearTimeout(timer);
}, [description, detect]);
```

- [ ] **Step 4: Update handleSave to use detected/custom category**

Replace `category` references in `handleSave`:

```ts
// Determine final category
const finalCategory = detectedCategory === 'other' && customCategory.trim()
  ? customCategory.trim().toLowerCase()
  : detectedCategory;

// Insert expense — replace `category` field:
const { data: expense, error: expErr } = await supabase
  .from('expenses')
  .insert({
    group_id: groupId,
    description: description.trim(),
    amount_cents: amtCents,
    paid_by_member_id: paidBy,
    category: finalCategory,          // ← was `category`
  })
  ...

// After successful save, reinforce or save mapping:
if (detectedCategory !== 'other') {
  reinforceMapping(description, detectedCategory);
} else if (customCategory.trim()) {
  saveMapping(description, customCategory.trim().toLowerCase());
}
```

- [ ] **Step 5: Replace category grid JSX with chip + conditional text input**

Remove the entire `{/* Category */}` `<View style={s.section}>` block (the 6-button grid).

Replace with:

```tsx
{/* Category — auto-detected chip */}
{description.trim().length > 0 && (
  <View style={s.section}>
    <View style={s.sectionHeader}>
      <MaterialIcons name="category" size={20} color={C.slate400} />
      <Text style={s.sectionLabel}>Category</Text>
    </View>
    <View style={s.categoryChipRow}>
      <View style={[s.categoryChip, detectedCategory === 'other' && s.categoryChipOther]}>
        <Text style={[s.categoryChipText, detectedCategory === 'other' && s.categoryChipTextOther]}>
          {CATEGORY_LABELS[detectedCategory] ?? detectedCategory}
        </Text>
      </View>
      <Text style={s.categoryAutoLabel}>Auto-detected</Text>
    </View>
    {detectedCategory === 'other' && (
      <TextInput
        style={s.categoryInput}
        placeholder="e.g. Health & Wellness"
        placeholderTextColor={C.slate400}
        value={customCategory}
        onChangeText={setCustomCategory}
        returnKeyType="done"
        testID="custom-category-input"
      />
    )}
    {detectedCategory === 'other' && customCategory.trim().length > 0 && (
      <Text style={s.categorySaveHint}>Saved for future auto-detection</Text>
    )}
  </View>
)}
```

- [ ] **Step 6: Add CATEGORY_LABELS constant and new styles**

Add near top of file (replacing old `CATEGORIES` constant):

```ts
const CATEGORY_LABELS: Record<string, string> = {
  restaurant: '🍽 Food & Drink',
  train: '🚗 Transport',
  hotel: '🏨 Accommodation',
  movie: '🎬 Entertainment',
  store: '🛍 Shopping',
  other: '⚙️ Other',
};
```

Add to `StyleSheet.create(...)` at bottom of file:

```ts
categoryChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
categoryChip: {
  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  backgroundColor: 'rgba(23,232,107,0.12)',
  borderWidth: 1, borderColor: 'rgba(23,232,107,0.35)',
},
categoryChipOther: {
  backgroundColor: 'rgba(148,163,184,0.08)',
  borderColor: 'rgba(148,163,184,0.25)',
},
categoryChipText: { color: C.primary, fontWeight: '600', fontSize: 13 },
categoryChipTextOther: { color: C.slate400 },
categoryAutoLabel: { color: C.slate500, fontSize: 11 },
categoryInput: {
  marginTop: 10, backgroundColor: C.surface, borderRadius: 10,
  paddingHorizontal: 14, paddingVertical: 10, color: C.white,
  fontSize: 14, borderWidth: 1, borderColor: C.surfaceHL,
},
categorySaveHint: { color: C.slate500, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
```

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 9: Run full test suite**

```bash
npm test --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add app/add-expense.tsx
git commit -m "feat: replace category grid with auto-detection chip and custom input"
```

---

## Final Verification

- [ ] Open app on device, navigate to Add Expense
- [ ] Type "dinner with friends" → chip shows "🍽 Food & Drink"
- [ ] Type "yoga class fee" → chip shows "⚙️ Other" + text input appears
- [ ] Enter "Health & Wellness" in text input, save expense
- [ ] Add another expense, type "yoga session" → chip now shows "health & wellness" (learned)
- [ ] Sign out → sign back in, type "yoga" → still shows learned category (Supabase-backed)

- [ ] **Final commit (if any cleanup needed)**

```bash
npm run lint && npm run typecheck && npm test --no-coverage
git add -A && git commit -m "feat: auto category detection complete"
```
