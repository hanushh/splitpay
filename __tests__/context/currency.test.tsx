import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { CurrencyProvider, useCurrency, CURRENCIES } from '@/context/currency';
import * as SecureStore from 'expo-secure-store';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CurrencyProvider>{children}</CurrencyProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as any).__resetStore?.();
});

describe('useCurrency', () => {
  it('defaults to INR', () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    expect(result.current.currency.code).toBe('INR');
  });

  it('format() renders INR amount correctly', () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    // 4500 cents = ₹45.00
    expect(result.current.format(4500)).toContain('45');
  });

  it('format() renders 0 correctly', () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    expect(result.current.format(0)).toContain('0');
  });

  it('format() handles negative amounts', () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    const formatted = result.current.format(-1000);
    expect(formatted).toContain('10');
  });

  it('setCurrency changes currency', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {
      result.current.setCurrency(CURRENCIES.find((c) => c.code === 'USD')!);
    });
    expect(result.current.currency.code).toBe('USD');
  });

  it('setCurrency persists to SecureStore', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {
      result.current.setCurrency(CURRENCIES.find((c) => c.code === 'EUR')!);
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'app_currency',
      expect.stringContaining('EUR'),
    );
  });

  it('format() uses noDecimals for JPY', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {
      result.current.setCurrency(CURRENCIES.find((c) => c.code === 'JPY')!);
    });
    // 1000 "cents" for JPY (no sub-unit) — should not have decimal
    const formatted = result.current.format(1000);
    expect(formatted).not.toContain('.');
  });

  it('CURRENCIES list includes all expected codes', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['USD', 'EUR', 'GBP', 'INR', 'JPY']));
  });

  it('loads persisted currency from SecureStore on mount', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('GBP');
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {});
    expect(result.current.currency.code).toBe('GBP');
  });

  it('ignores unknown currency code from SecureStore', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('ZZZ');
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {});
    // Falls back to default INR
    expect(result.current.currency.code).toBe('INR');
  });

  it('formatAbs returns same as format (absolute value)', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    // Both should return the same value since format is an alias for formatAbs
    expect(result.current.format(5000)).toBe(result.current.formatAbs(5000));
    expect(result.current.format(-5000)).toBe(result.current.formatAbs(-5000));
  });

  it('format() rounds JPY correctly (no decimals)', async () => {
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await act(async () => {
      result.current.setCurrency(CURRENCIES.find((c) => c.code === 'JPY')!);
    });
    // 1050 for JPY should display as ¥1,050 (whole number)
    const formatted = result.current.format(1050);
    expect(formatted).toContain('1');
    expect(formatted).not.toContain('.');
  });
});
