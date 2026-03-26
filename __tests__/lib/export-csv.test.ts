import { buildCsv, type ExportableExpense } from '@/lib/export-csv';

const SAMPLE_EXPENSES: ExportableExpense[] = [
  {
    description: 'Dinner at Mario\'s',
    total_amount_cents: 5000,
    currency_code: 'USD',
    category: 'restaurant',
    created_at: '2026-03-15T18:30:00Z',
    paid_by_name: 'Alice',
    your_split_cents: 2500,
  },
  {
    description: 'Train tickets',
    total_amount_cents: 3200,
    currency_code: 'EUR',
    category: 'train',
    created_at: '2026-03-16T10:00:00Z',
    paid_by_name: 'Bob',
    your_split_cents: 1600,
  },
];

describe('buildCsv', () => {
  it('generates a CSV with header and data rows', () => {
    const csv = buildCsv('Trip Group', SAMPLE_EXPENSES);
    const lines = csv.split('\n');

    expect(lines[0]).toBe(
      'Date,Description,Category,Paid By,Total Amount,Your Share,Currency',
    );
    expect(lines.length).toBe(3); // header + 2 rows
  });

  it('escapes descriptions containing commas', () => {
    const expenses: ExportableExpense[] = [
      {
        description: 'Food, drinks, and tips',
        total_amount_cents: 1000,
        currency_code: 'USD',
        category: 'restaurant',
        created_at: '2026-03-15T12:00:00Z',
        paid_by_name: 'Alice',
        your_split_cents: 500,
      },
    ];
    const csv = buildCsv('Test', expenses);
    expect(csv).toContain('"Food, drinks, and tips"');
  });

  it('formats cents correctly for USD (2 decimals)', () => {
    const csv = buildCsv('Test', [SAMPLE_EXPENSES[0]]);
    const dataRow = csv.split('\n')[1];
    // Total: 5000 cents = 50.00, Share: 2500 cents = 25.00
    expect(dataRow).toContain('50.00');
    expect(dataRow).toContain('25.00');
  });

  it('formats cents correctly for JPY (no decimals)', () => {
    const expenses: ExportableExpense[] = [
      {
        description: 'Ramen',
        total_amount_cents: 1200,
        currency_code: 'JPY',
        category: 'restaurant',
        created_at: '2026-03-15T12:00:00Z',
        paid_by_name: 'Yuki',
        your_split_cents: 600,
      },
    ];
    const csv = buildCsv('Tokyo Trip', expenses);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('1200');
    expect(dataRow).toContain('600');
  });

  it('returns only header when expenses array is empty', () => {
    const csv = buildCsv('Empty', []);
    const lines = csv.split('\n');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('Date');
  });
});
