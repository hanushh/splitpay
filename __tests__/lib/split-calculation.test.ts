/**
 * Tests for the split calculation logic used in add-expense.tsx.
 * The logic is extracted here for pure unit testing without React.
 */

/** Mirrors the split computation in add-expense.tsx handleSave() */
function computeSplits(amtCents: number, memberIds: string[]) {
  const perPerson = Math.round(amtCents / memberIds.length);
  return memberIds.map((memberId, i) => ({
    member_id: memberId,
    amount_cents:
      i === memberIds.length - 1
        ? amtCents - perPerson * (memberIds.length - 1)
        : perPerson,
  }));
}

describe('Split calculation (equally)', () => {
  it('splits evenly between 2 people', () => {
    const splits = computeSplits(2000, ['a', 'b']);
    expect(splits[0].amount_cents).toBe(1000);
    expect(splits[1].amount_cents).toBe(1000);
  });

  it('total always equals original amount', () => {
    const cases = [
      { amount: 1000, count: 3 },
      { amount: 999, count: 3 },
      { amount: 100, count: 7 },
      { amount: 5000, count: 4 },
    ];
    for (const { amount, count } of cases) {
      const ids = Array.from({ length: count }, (_, i) => `m${i}`);
      const splits = computeSplits(amount, ids);
      const total = splits.reduce((s, x) => s + x.amount_cents, 0);
      expect(total).toBe(amount);
    }
  });

  it('last member absorbs rounding remainder', () => {
    // 1000 / 3 = 333.33 → perPerson=333, last gets 1000 - 333*2 = 334
    const splits = computeSplits(1000, ['a', 'b', 'c']);
    expect(splits[0].amount_cents).toBe(333);
    expect(splits[1].amount_cents).toBe(333);
    expect(splits[2].amount_cents).toBe(334);
  });

  it('handles single member (pays all)', () => {
    const splits = computeSplits(5000, ['only']);
    expect(splits[0].amount_cents).toBe(5000);
  });

  it('assigns correct member IDs', () => {
    const splits = computeSplits(300, ['alice', 'bob', 'carol']);
    expect(splits.map((s) => s.member_id)).toEqual(['alice', 'bob', 'carol']);
  });
});

/** Mirrors canSave logic in add-expense.tsx */
function canSave(
  description: string,
  amount: string,
  groupId: string,
  selectedCount: number,
) {
  return !!description && !!amount && !!groupId && selectedCount > 0;
}

describe('canSave logic', () => {
  it('returns true when all fields are filled', () => {
    expect(canSave('Dinner', '50.00', 'group-1', 3)).toBe(true);
  });

  it('returns false when description is empty', () => {
    expect(canSave('', '50.00', 'group-1', 3)).toBe(false);
  });

  it('returns false when amount is empty', () => {
    expect(canSave('Dinner', '', 'group-1', 3)).toBe(false);
  });

  it('returns false when no group selected', () => {
    expect(canSave('Dinner', '50.00', '', 3)).toBe(false);
  });

  it('returns false when no members selected', () => {
    expect(canSave('Dinner', '50.00', 'group-1', 0)).toBe(false);
  });
});

// ─── Helpers mirroring add-expense.tsx ────────────────────────────────────────

function buildCustomSplits(
  splitMethod: 'equally' | 'exact' | 'percent',
  selectedMembers: string[],
  exactAmounts: Record<string, string>,
  percentAmounts: Record<string, string>,
  amtCents: number,
): { memberIds: string[]; amountsCents: number[] } | null {
  if (splitMethod === 'equally') return null;
  const ids = selectedMembers;
  if (splitMethod === 'exact') {
    const cents = ids.map((id) =>
      Math.round((parseFloat(exactAmounts[id] ?? '0') || 0) * 100),
    );
    return { memberIds: ids, amountsCents: cents };
  }
  const percents = ids.map((id) => parseFloat(percentAmounts[id] ?? '0') || 0);
  const raw = percents.map((p) => Math.floor((p / 100) * amtCents));
  const remainder = amtCents - raw.reduce((a, b) => a + b, 0);
  if (raw.length > 0) raw[raw.length - 1] += remainder;
  return { memberIds: ids, amountsCents: raw };
}

function validateCustomSplits(
  splitMethod: 'equally' | 'exact' | 'percent',
  selectedMembers: string[],
  exactAmounts: Record<string, string>,
  percentAmounts: Record<string, string>,
  amtCents: number,
): string | null {
  if (splitMethod === 'equally') return null;
  const ids = selectedMembers;
  if (splitMethod === 'exact') {
    const hasBlank = ids.some((id) => !exactAmounts[id]?.trim());
    if (hasBlank) return 'Enter an amount for each member.';
    const total = ids.reduce(
      (s, id) => s + Math.round((parseFloat(exactAmounts[id]) || 0) * 100),
      0,
    );
    if (total !== amtCents)
      return `Amounts must sum to ${(amtCents / 100).toFixed(2)}.`;
  } else {
    const hasBlank = ids.some((id) => !percentAmounts[id]?.trim());
    if (hasBlank) return 'Enter a percentage for each member.';
    const total = ids.reduce(
      (s, id) => s + (parseFloat(percentAmounts[id]) || 0),
      0,
    );
    if (Math.abs(total - 100) > 0.01)
      return `Percentages must sum to 100% (currently ${total.toFixed(2)}%).`;
  }
  return null;
}

// ─── buildCustomSplits (equally) ──────────────────────────────────────────────

describe('buildCustomSplits (equally)', () => {
  it('returns null for equal splits', () => {
    expect(
      buildCustomSplits('equally', ['a', 'b'], {}, {}, 2000),
    ).toBeNull();
  });
});

// ─── buildCustomSplits (exact) ────────────────────────────────────────────────

describe('buildCustomSplits (exact)', () => {
  it('passes through provided amounts in cents', () => {
    const result = buildCustomSplits(
      'exact',
      ['a', 'b'],
      { a: '10.00', b: '15.00' },
      {},
      2500,
    );
    expect(result?.amountsCents).toEqual([1000, 1500]);
    expect(result?.memberIds).toEqual(['a', 'b']);
  });

  it('treats blank field as 0 cents', () => {
    const result = buildCustomSplits(
      'exact',
      ['a', 'b'],
      { a: '20.00' }, // b is missing
      {},
      2000,
    );
    expect(result?.amountsCents).toEqual([2000, 0]);
  });

  it('rounds decimal input to nearest cent', () => {
    const result = buildCustomSplits(
      'exact',
      ['a'],
      { a: '10.005' },
      {},
      1001,
    );
    expect(result?.amountsCents[0]).toBe(1001); // Math.round(10.005 * 100) = 1001
  });
});

// ─── buildCustomSplits (percent) ──────────────────────────────────────────────

describe('buildCustomSplits (percent)', () => {
  it('splits 50/50 correctly', () => {
    const result = buildCustomSplits(
      'percent',
      ['a', 'b'],
      {},
      { a: '50', b: '50' },
      2000,
    );
    expect(result?.amountsCents).toEqual([1000, 1000]);
  });

  it('total always equals amtCents (3-way 33.33/33.33/33.34)', () => {
    const result = buildCustomSplits(
      'percent',
      ['a', 'b', 'c'],
      {},
      { a: '33.33', b: '33.33', c: '33.34' },
      1000,
    );
    const total = result!.amountsCents.reduce((s, x) => s + x, 0);
    expect(total).toBe(1000);
  });

  it('last member absorbs rounding remainder for even 3-way split', () => {
    // 33.33% each: Math.floor(0.3333 * 1000) = 333 for first two,
    // remainder = 1000 - 666 = 334 added to last
    const result = buildCustomSplits(
      'percent',
      ['a', 'b', 'c'],
      {},
      { a: '33.33', b: '33.33', c: '33.34' },
      1000,
    );
    expect(result!.amountsCents[0]).toBe(333);
    expect(result!.amountsCents[1]).toBe(333);
    expect(result!.amountsCents[2]).toBe(334);
  });

  it('total always equals amtCents for various amounts and percentages', () => {
    const cases = [
      { pcts: ['25', '25', '25', '25'], amt: 333 },
      { pcts: ['10', '90'], amt: 7777 },
      { pcts: ['33.33', '33.33', '33.34'], amt: 9999 },
    ];
    for (const { pcts, amt } of cases) {
      const ids = pcts.map((_, i) => `m${i}`);
      const percentAmounts = Object.fromEntries(ids.map((id, i) => [id, pcts[i]]));
      const result = buildCustomSplits('percent', ids, {}, percentAmounts, amt);
      const total = result!.amountsCents.reduce((s, x) => s + x, 0);
      expect(total).toBe(amt);
    }
  });
});

// ─── validateCustomSplits ─────────────────────────────────────────────────────

describe('validateCustomSplits', () => {
  it('returns null for equally (no validation needed)', () => {
    expect(validateCustomSplits('equally', ['a', 'b'], {}, {}, 2000)).toBeNull();
  });

  // Exact mode
  it('returns null for valid exact split', () => {
    expect(
      validateCustomSplits('exact', ['a', 'b'], { a: '10.00', b: '10.00' }, {}, 2000),
    ).toBeNull();
  });

  it('returns error when exact amounts do not sum to total', () => {
    const err = validateCustomSplits(
      'exact',
      ['a', 'b'],
      { a: '10.00', b: '5.00' },
      {},
      2000,
    );
    expect(err).not.toBeNull();
    expect(err).toContain('20.00');
  });

  it('returns error when exact has a blank field', () => {
    const err = validateCustomSplits(
      'exact',
      ['a', 'b'],
      { a: '20.00' }, // b missing
      {},
      2000,
    );
    expect(err).not.toBeNull();
    expect(err).toContain('amount');
  });

  // Percent mode
  it('returns null for valid percent split summing to 100%', () => {
    expect(
      validateCustomSplits('percent', ['a', 'b'], {}, { a: '50', b: '50' }, 2000),
    ).toBeNull();
  });

  it('returns null for percent split with floating-point sum within 0.01 of 100', () => {
    // 33.33 + 33.33 + 33.34 = 100.00 exactly
    expect(
      validateCustomSplits(
        'percent',
        ['a', 'b', 'c'],
        {},
        { a: '33.33', b: '33.33', c: '33.34' },
        1000,
      ),
    ).toBeNull();
  });

  it('returns error when percent sums to 99%', () => {
    const err = validateCustomSplits(
      'percent',
      ['a', 'b'],
      {},
      { a: '49', b: '50' },
      2000,
    );
    expect(err).not.toBeNull();
    expect(err).toContain('99.00');
  });

  it('returns error when percent sums to 101%', () => {
    const err = validateCustomSplits(
      'percent',
      ['a', 'b'],
      {},
      { a: '51', b: '50' },
      2000,
    );
    expect(err).not.toBeNull();
    expect(err).toContain('101.00');
  });

  it('returns error when percent has a blank field', () => {
    const err = validateCustomSplits(
      'percent',
      ['a', 'b'],
      {},
      { a: '100' }, // b missing
      2000,
    );
    expect(err).not.toBeNull();
    expect(err).toContain('percentage');
  });
});

// ─── Edit-mode split computation (regression guard) ───────────────────────────

describe('Edit mode equal split (regression guard)', () => {
  it('computes per-person splits with last-member rounding when customSplits is null', () => {
    const amtCents = 1000;
    const splitIds = ['a', 'b', 'c'];
    const customSplits = null; // equal split path
    const splitCents = customSplits
      ? (customSplits as { amountsCents: number[] }).amountsCents
      : splitIds.map((_, i) => {
          const perPerson = Math.round(amtCents / splitIds.length);
          return i === splitIds.length - 1
            ? amtCents - perPerson * (splitIds.length - 1)
            : perPerson;
        });
    expect(splitCents).toEqual([333, 333, 334]);
    expect(splitCents.reduce((s, x) => s + x, 0)).toBe(1000);
  });

  it('uses customSplits.amountsCents when provided (non-equal path)', () => {
    const customSplits = { memberIds: ['a', 'b'], amountsCents: [700, 300] };
    const splitCents = customSplits.amountsCents;
    expect(splitCents).toEqual([700, 300]);
  });
});

/** Amount parsing */
describe('Amount parsing', () => {
  it('converts decimal string to cents', () => {
    expect(Math.round(parseFloat('45.99') * 100)).toBe(4599);
  });

  it('converts integer string to cents', () => {
    expect(Math.round(parseFloat('100') * 100)).toBe(10000);
  });

  it('returns NaN for invalid input', () => {
    expect(isNaN(parseFloat('abc'))).toBe(true);
  });

  it('rejects zero amount', () => {
    const amtCents = Math.round(parseFloat('0') * 100);
    expect(amtCents <= 0).toBe(true);
  });
});
