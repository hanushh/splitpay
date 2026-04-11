import { DEFAULT_COUNTRY_CODE } from '@/lib/app-config';

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const cc = DEFAULT_COUNTRY_CODE.replace('+', ''); // e.g. '1'
  if (digits.length === 10) return `${DEFAULT_COUNTRY_CODE}${digits}`;
  if (digits.length === 11 && digits[0] === cc) return `+${digits}`;
  if (digits.length > 6) return `+${digits}`;
  return null;
}
