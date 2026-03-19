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
