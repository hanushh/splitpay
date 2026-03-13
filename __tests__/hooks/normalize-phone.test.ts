import { normalizePhone } from '@/hooks/use-friends';

jest.mock('@/lib/supabase');
jest.mock('expo-contacts');
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(),
}));
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: null }),
}));

describe('normalizePhone', () => {
  it('normalizes a 10-digit US number', () => {
    expect(normalizePhone('4155552671')).toBe('+14155552671');
  });

  it('normalizes a 10-digit US number with formatting', () => {
    expect(normalizePhone('(415) 555-2671')).toBe('+14155552671');
  });

  it('normalizes an 11-digit number starting with 1', () => {
    expect(normalizePhone('14155552671')).toBe('+14155552671');
  });

  it('normalizes an already-formatted E.164 number', () => {
    expect(normalizePhone('+14155552671')).toBe('+14155552671');
  });

  it('handles a number with country code > 11 digits', () => {
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
  });

  it('returns null for a number that is too short', () => {
    expect(normalizePhone('12345')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });
});
