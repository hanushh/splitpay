/**
 * Tests for simplifyDebts — the greedy min-cash-flow algorithm that turns
 * per-member net balances into a minimal "who pays whom" settlement plan.
 */
import {
  simplifyDebts,
  type MemberBalance,
  type SettlementTransaction,
} from '@/lib/balance-utils';

let _id = 0;
function member(balance_cents: number, currency_code = 'USD'): MemberBalance {
  _id += 1;
  return {
    member_id: `m${_id}`,
    user_id: `u${_id}`,
    display_name: `Member ${_id}`,
    avatar_url: null,
    currency_code,
    balance_cents,
  };
}

function sumPositive(balances: MemberBalance[], currency = 'USD'): number {
  return balances
    .filter((b) => b.currency_code === currency && b.balance_cents > 0)
    .reduce((n, b) => n + b.balance_cents, 0);
}

function sumAmounts(txns: SettlementTransaction[], currency = 'USD'): number {
  return txns
    .filter((t) => t.currency_code === currency)
    .reduce((n, t) => n + t.amount_cents, 0);
}

describe('simplifyDebts', () => {
  it('returns no transactions for empty input', () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it('returns no transactions when everyone is settled (all zero)', () => {
    expect(simplifyDebts([member(0), member(0)])).toEqual([]);
  });

  it('settles a simple two-person debt', () => {
    const creditor = member(1000);
    const debtor = member(-1000);
    const txns = simplifyDebts([creditor, debtor]);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      from_member_id: debtor.member_id,
      to_member_id: creditor.member_id,
      amount_cents: 1000,
      currency_code: 'USD',
    });
  });

  it('reconciles exactly across multiple debtors and creditors', () => {
    const balances = [member(1500), member(-500), member(-1000)];
    const txns = simplifyDebts(balances);
    expect(sumAmounts(txns)).toBe(sumPositive(balances));
    expect(txns.every((t) => t.amount_cents > 0)).toBe(true);
  });

  it('keeps currencies isolated (never produces a cross-currency payment)', () => {
    const balances = [
      member(1000, 'USD'),
      member(-1000, 'USD'),
      member(2000, 'EUR'),
      member(-2000, 'EUR'),
    ];
    const txns = simplifyDebts(balances);
    expect(sumAmounts(txns, 'USD')).toBe(1000);
    expect(sumAmounts(txns, 'EUR')).toBe(2000);
    for (const t of txns) {
      // Each transaction's amount belongs entirely to one currency bucket.
      expect(['USD', 'EUR']).toContain(t.currency_code);
    }
  });

  it('carries through external members with a null user_id', () => {
    const external: MemberBalance = {
      member_id: 'ext1',
      user_id: null,
      display_name: 'Guest',
      avatar_url: null,
      currency_code: 'USD',
      balance_cents: -800,
    };
    const txns = simplifyDebts([member(800), external]);
    expect(txns).toHaveLength(1);
    expect(txns[0].from_member_id).toBe('ext1');
    expect(txns[0].from_user_id).toBeNull();
  });

  it('produces at most (debtors + creditors - 1) transactions per currency', () => {
    const balances = [
      member(1000),
      member(500),
      member(-300),
      member(-700),
      member(-500),
    ];
    const debtors = balances.filter((b) => b.balance_cents < 0).length;
    const creditors = balances.filter((b) => b.balance_cents > 0).length;
    const txns = simplifyDebts(balances);
    expect(txns.length).toBeLessThanOrEqual(debtors + creditors - 1);
    expect(sumAmounts(txns)).toBe(sumPositive(balances));
  });
});
