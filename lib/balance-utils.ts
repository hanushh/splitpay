export interface CurrencyBalance {
  currency_code: string;
  balance_cents: number;
}

/**
 * A member's net balance in a group, for a single currency, as returned by
 * the `get_all_group_balances` RPC.  Positive = the member is owed money
 * (a creditor); negative = the member owes money (a debtor).
 */
export interface MemberBalance {
  member_id: string;
  user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  currency_code: string;
  balance_cents: number;
}

/**
 * A single suggested payment in a simplified settlement plan: the debtor
 * (`from_*`) pays the creditor (`to_*`) `amount_cents` (always positive) in
 * `currency_code`.
 */
export interface SettlementTransaction {
  currency_code: string;
  from_member_id: string;
  from_user_id: string | null;
  from_name: string | null;
  from_avatar_url: string | null;
  to_member_id: string;
  to_user_id: string | null;
  to_name: string | null;
  to_avatar_url: string | null;
  amount_cents: number;
}

interface DebtNode {
  member_id: string;
  user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  remaining: number; // positive magnitude
}

/**
 * Reduces a set of per-member net balances into the minimal set of payments
 * that settles everyone ("who pays whom"), using a greedy min-cash-flow
 * algorithm.  Each currency is settled independently — payments never mix
 * currencies.
 *
 * Inputs are integer cents, so all arithmetic stays integer and totals
 * reconcile exactly.  If a currency's balances do not sum to zero (e.g. from
 * a partial or cross-currency settlement), we simply stop once either side is
 * exhausted rather than inventing money.
 */
export function simplifyDebts(balances: MemberBalance[]): SettlementTransaction[] {
  // Partition by currency.
  const byCurrency = new Map<string, MemberBalance[]>();
  for (const b of balances) {
    if (!b.currency_code || b.balance_cents === 0) continue;
    const list = byCurrency.get(b.currency_code);
    if (list) list.push(b);
    else byCurrency.set(b.currency_code, [b]);
  }

  const transactions: SettlementTransaction[] = [];

  // Deterministic order: alphabetical by currency code.
  for (const currency_code of [...byCurrency.keys()].sort()) {
    const rows = byCurrency.get(currency_code)!;
    const creditors: DebtNode[] = [];
    const debtors: DebtNode[] = [];
    for (const r of rows) {
      const node: DebtNode = {
        member_id: r.member_id,
        user_id: r.user_id,
        display_name: r.display_name,
        avatar_url: r.avatar_url,
        remaining: Math.abs(r.balance_cents),
      };
      if (r.balance_cents > 0) creditors.push(node);
      else debtors.push(node);
    }

    // Greedily match the largest creditor with the largest debtor.
    while (creditors.length > 0 && debtors.length > 0) {
      const creditor = creditors.reduce((a, b) => (b.remaining > a.remaining ? b : a));
      const debtor = debtors.reduce((a, b) => (b.remaining > a.remaining ? b : a));
      const amount = Math.min(creditor.remaining, debtor.remaining);
      if (amount <= 0) break;

      transactions.push({
        currency_code,
        from_member_id: debtor.member_id,
        from_user_id: debtor.user_id,
        from_name: debtor.display_name,
        from_avatar_url: debtor.avatar_url,
        to_member_id: creditor.member_id,
        to_user_id: creditor.user_id,
        to_name: creditor.display_name,
        to_avatar_url: creditor.avatar_url,
        amount_cents: amount,
      });

      creditor.remaining -= amount;
      debtor.remaining -= amount;
      if (creditor.remaining === 0) creditors.splice(creditors.indexOf(creditor), 1);
      if (debtor.remaining === 0) debtors.splice(debtors.indexOf(debtor), 1);
    }
  }

  return transactions;
}

/**
 * Returns 'owed' if the user is owed money in any currency,
 * 'owes' if the user owes money in any currency,
 * or 'settled' if all balances are zero (or the array is empty).
 *
 * 'owes' takes priority over 'owed' when both signs exist.
 */
export function deriveBalanceStatus(
  balances: CurrencyBalance[],
): 'owed' | 'owes' | 'settled' {
  let hasPositive = false;
  let hasNegative = false;
  for (const b of balances) {
    if (b.balance_cents < 0) hasNegative = true;
    else if (b.balance_cents > 0) hasPositive = true;
  }
  if (hasNegative) return 'owes';
  if (hasPositive) return 'owed';
  return 'settled';
}

/**
 * Returns balances sorted by absolute value descending —
 * the largest (most significant) balance first.
 */
export function sortBalancesDesc(balances: CurrencyBalance[]): CurrencyBalance[] {
  return [...balances].sort(
    (a, b) => Math.abs(b.balance_cents) - Math.abs(a.balance_cents),
  );
}

/**
 * Merges per-group (or per-friend) balance arrays into a single summary,
 * summing by currency_code across all items.  Zero totals are excluded.
 */
export function mergeBalances(items: { balances: CurrencyBalance[] }[]): CurrencyBalance[] {
  const map = new Map<string, number>();
  for (const item of items) {
    for (const b of (item.balances ?? [])) {
      map.set(b.currency_code, (map.get(b.currency_code) ?? 0) + b.balance_cents);
    }
  }
  const result: CurrencyBalance[] = [];
  for (const [currency_code, balance_cents] of map) {
    if (balance_cents !== 0) result.push({ currency_code, balance_cents });
  }
  return sortBalancesDesc(result);
}
