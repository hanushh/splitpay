/** Convert cents (integer) to a dollar amount string: 1234 → "12.34" */
export function centsToDisplay(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

/** Convert dollars (float) to cents integer: 12.34 → 1234 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Format a balance in cents as a human-readable string */
export function describeBalance(cents: number, currency = 'USD'): string {
  const amount = centsToDisplay(cents);
  if (cents > 0) return `owed ${currency} ${amount}`;
  if (cents < 0) return `owes ${currency} ${amount}`;
  return 'settled up';
}

/** Extract a readable error message from an unknown thrown value */
export function formatError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Wrap tool output as MCP text content */
export function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap an error as MCP error content */
export function err(
  error: unknown
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
    isError: true,
  };
}
