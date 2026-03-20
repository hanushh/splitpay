import * as SecureStore from 'expo-secure-store';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

const STORAGE_KEY = 'app_currency';

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  flag: string;
  noDecimals?: boolean;
}

export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  {
    code: 'JPY',
    symbol: '¥',
    name: 'Japanese Yen',
    flag: '🇯🇵',
    noDecimals: true,
  },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', flag: '🇲🇽' },
];

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /** Formats an integer cent value (e.g. 4500 → "$45.00"). */
  format: (cents: number) => string;
  /** Formats an absolute cent value with no sign. */
  formatAbs: (cents: number) => string;
}

const DEFAULT_CURRENCY = CURRENCIES.find((c) => c.code === 'INR')!;

const CurrencyContext = createContext<CurrencyContextType>({
  currency: DEFAULT_CURRENCY,
  setCurrency: () => {},
  format: (cents) => `$${(cents / 100).toFixed(2)}`,
  formatAbs: (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`,
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(DEFAULT_CURRENCY);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((code) => {
      if (code) {
        const found = CURRENCIES.find((c) => c.code === code);
        if (found) setCurrencyState(found);
      }
    });
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    SecureStore.setItemAsync(STORAGE_KEY, c.code);
  }, []);

  const formatAbs = useCallback(
    (cents: number) => {
      if (currency.noDecimals) {
        return `${currency.symbol}${Math.round(Math.abs(cents)).toLocaleString()}`;
      }
      return `${currency.symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
    },
    [currency],
  );
  const format = formatAbs; // alias (we always display absolute values with sign handled by caller)

  return (
    <CurrencyContext.Provider
      value={{ currency, setCurrency, format, formatAbs }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}

/** Format cents using a specific currency code (falls back to INR if unknown). */
export function formatCentsWithCurrency(cents: number, currencyCode: string): string {
  const currency = CURRENCIES.find((c) => c.code === currencyCode) ?? CURRENCIES.find((c) => c.code === 'INR')!;
  if (currency.noDecimals) {
    return `${currency.symbol}${Math.round(Math.abs(cents)).toLocaleString()}`;
  }
  return `${currency.symbol}${(Math.abs(cents) / 100).toFixed(2)}`;
}
