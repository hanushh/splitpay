export interface CurrencyBalance {
  currency_code: string;
  balance_cents: number;
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
