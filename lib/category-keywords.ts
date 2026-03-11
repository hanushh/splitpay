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
 * Lowercases, strips punctuation, splits on whitespace, filters stop-words and short tokens.
 *
 * Design: Normalize punctuation before splitting: "McDonald's" → "mcdonalds" (single token).
 * Trade-off: compound words like "amazon.com" become "amazoncom", but the learned
 * mappings system adapts by building associations on actual user input.
 */
export function extractKeywords(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
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
