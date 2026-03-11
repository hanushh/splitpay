# Auto Category Detection — Design Spec
**Date:** 2026-03-10
**Status:** Approved

---

## Overview

Replace the manual 6-button category picker in Add Expense with intelligent auto-detection based on the expense description. Category is inferred silently; the user only intervenes when detection falls back to "Other" by typing a free-form category name that is saved globally for future use.

---

## Goals

- Zero manual category selection in the happy path
- Community-driven learning: every user's manual entry improves detection for all users
- Zero latency on detection (synchronous, in-memory lookup)
- Minimal running cost — no LLM calls, no per-keystroke network requests

---

## Data Model

### New Supabase table: `category_keyword_mappings`

```sql
CREATE TABLE public.category_keyword_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword      text NOT NULL,
  category     text NOT NULL,
  usage_count  integer NOT NULL DEFAULT 1,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (keyword, category)
);

CREATE INDEX ON public.category_keyword_mappings (usage_count DESC);

-- RLS
ALTER TABLE public.category_keyword_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can read" ON public.category_keyword_mappings FOR SELECT USING (true);
CREATE POLICY "authenticated users can upsert" ON public.category_keyword_mappings
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated users can update count" ON public.category_keyword_mappings
  FOR UPDATE TO authenticated USING (true);
```

- A keyword can map to multiple categories (one row per keyword+category pair)
- `usage_count` is incremented on every successful auto-detection match and on every manual save
- Read is public (all users benefit from all mappings)

---

## Detection Algorithm

### Keyword Extraction
Input: raw description string
1. Lowercase
2. Split on `/[\s\.,\-\(\)\'\"]+/`
3. Remove stop words: `a, an, the, to, for, in, at, on, with, and, or, by, of, from`
4. Discard tokens shorter than 3 characters

Example: `"Dinner at McDonald's with friends"` → `["dinner", "mcdonalds", "friends"]`

### Two-Tier Scoring
For each extracted keyword, score against two sources:

| Source | Score contribution |
|---|---|
| Built-in keyword dict (`lib/category-keywords.ts`) | +10 per match |
| Learned Supabase mappings (cached) | +usage_count per match |

Accumulate scores per category across all keywords. Winner = highest total score.
Tie-break: built-in category wins over learned.
No matches → `"other"`.

### Auto-reinforcement
When auto-detection picks a non-other category and the user saves the expense, increment `usage_count` for each matched (keyword, category) pair in Supabase.

---

## Built-in Keyword Dictionary (`lib/category-keywords.ts`)

A flat `Record<string, string>` mapping keyword → category key:

```ts
export const KEYWORD_DICT: Record<string, string> = {
  // Food & Drink
  dinner: 'restaurant', lunch: 'restaurant', breakfast: 'restaurant',
  coffee: 'restaurant', cafe: 'restaurant', zomato: 'restaurant',
  swiggy: 'restaurant', mcdonalds: 'restaurant', restaurant: 'restaurant',
  food: 'restaurant', pizza: 'restaurant', burger: 'restaurant',
  // Transport
  uber: 'train', ola: 'train', taxi: 'train', metro: 'train',
  bus: 'train', train: 'train', flight: 'train', fuel: 'train',
  petrol: 'train', toll: 'train',
  // Accommodation
  hotel: 'hotel', airbnb: 'hotel', hostel: 'hotel', rent: 'hotel',
  // Entertainment
  netflix: 'movie', movie: 'movie', cinema: 'movie', concert: 'movie',
  spotify: 'movie', ticket: 'movie',
  // Shopping
  amazon: 'store', flipkart: 'store', grocery: 'store', groceries: 'store',
  walmart: 'store', mall: 'store', shopping: 'store',
  // Other (explicit fallback keywords)
};
```

---

## Cache Layer (`hooks/use-category-cache.ts`)

### AsyncStorage structure
```ts
// key: '@category_cache_v1'
{
  mappings: { [keyword: string]: { [category: string]: number } },
  fetched_at: number  // unix ms timestamp
}
```

### Lifecycle

| Event | Action |
|---|---|
| App startup (authenticated) | Fetch top 3000 rows `ORDER BY usage_count DESC` from Supabase → write to AsyncStorage + in-memory |
| Cache age > 24h | Re-fetch from Supabase on next `detect()` call |
| User saves custom category | Upsert to Supabase + merge into in-memory cache immediately |
| Auto-detection fires a match | Increment `usage_count` in Supabase + update in-memory count |
| User logout | Delete AsyncStorage key + clear in-memory cache |

### Hook API
```ts
export function useCategoryCache() {
  return {
    detect(description: string): string,            // sync, returns category key
    saveMapping(description: string, category: string): Promise<void>,
    reinforceMapping(description: string, category: string): Promise<void>,
  }
}
```

`detect()` is fully synchronous — reads from in-memory map, zero latency.

---

## UI Changes (`app/add-expense.tsx`)

### Removed
- The `CATEGORIES` constant and the entire 6-button category grid section

### Added

**1. Category chip** (shown whenever a category is detected, including "other"):
```
[ 🍽 Food & Drink ]   ← green chip, read-only
Auto-detected from description
```

**2. Custom category text input** (shown only when detected category is `"other"`):
```
[ e.g. Health & Wellness            ]
  Saved for future auto-detection
```

**Detection trigger:** `useEffect` on `description` with 300ms debounce — calls `detect(description)` and updates local `category` state.

**On save (handleSave):**
- If category was auto-detected (non-other): call `reinforceMapping(description, category)`
- If user typed a custom category: call `saveMapping(description, customCategory)`, use custom category as the expense's `category` field

---

## Files Changed / Created

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDD_create_category_keyword_mappings.sql` | New migration |
| `lib/category-keywords.ts` | New — built-in keyword dict |
| `hooks/use-category-cache.ts` | New — cache + detect + save logic |
| `app/add-expense.tsx` | Remove category grid, add chip + text input, wire up hook |

---

## Out of Scope

- Editing or deleting learned mappings (append-only for now)
- Per-user private mappings (all mappings are global)
- LLM-based classification
- Category management UI (admin panel, deduplication)
