import { Platform, Share } from 'react-native';
import { CURRENCIES } from '@/context/currency';

export interface ExportableExpense {
  description: string;
  total_amount_cents: number;
  currency_code: string;
  category: string;
  created_at: string;
  paid_by_name: string;
  your_split_cents: number;
}

function formatCents(cents: number, currencyCode: string): string {
  const currency = CURRENCIES.find((c) => c.code === currencyCode);
  const noDecimals = currency?.noDecimals ?? false;
  if (noDecimals) return String(Math.round(Math.abs(cents)));
  return (Math.abs(cents) / 100).toFixed(2);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function buildCsv(
  groupName: string,
  expenses: ExportableExpense[],
): string {
  const header = [
    'Date',
    'Description',
    'Category',
    'Paid By',
    'Total Amount',
    'Your Share',
    'Currency',
  ].join(',');

  const rows = expenses.map((e) =>
    [
      escapeCsvField(formatDate(e.created_at)),
      escapeCsvField(e.description),
      escapeCsvField(e.category),
      escapeCsvField(e.paid_by_name),
      formatCents(e.total_amount_cents, e.currency_code),
      formatCents(e.your_split_cents, e.currency_code),
      e.currency_code,
    ].join(','),
  );

  return [header, ...rows].join('\n');
}

export async function shareExpenseCsv(
  groupName: string,
  expenses: ExportableExpense[],
): Promise<void> {
  const csv = buildCsv(groupName, expenses);
  const filename = `${groupName.replace(/[^a-zA-Z0-9]/g, '_')}_expenses.csv`;

  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  await Share.share({
    message: csv,
    title: filename,
  });
}
