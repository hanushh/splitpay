import {
  extractKeywords,
  scoreDescription,
  KEYWORD_DICT,
} from '@/lib/category-keywords';

describe('extractKeywords', () => {
  it('lowercases and splits on whitespace', () => {
    expect(extractKeywords('Dinner at Zomato')).toEqual(
      expect.arrayContaining(['dinner', 'zomato']),
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

  it('reinforces same category from both sources', () => {
    // built-in gives 'restaurant' +10 via 'dinner'
    // learned gives 'restaurant' +10 via 'dinner' — both reinforce same category
    const learned = { dinner: { restaurant: 10 } };
    expect(scoreDescription(['dinner'], learned)).toBe('restaurant');
  });

  it('built-in category wins when scores are tied', () => {
    // 'dinner': built-in → restaurant (+10), learned → 'health' (+10)
    // Tie at 10 each → built-in (restaurant) wins
    const learned = { dinner: { health: 10 } };
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
