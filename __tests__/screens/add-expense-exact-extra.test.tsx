import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import AddExpenseScreen from '@/app/add-expense';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams } from 'expo-router';

jest.mock('@/lib/supabase');
const mockStableUser = { id: 'user-1' };
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: mockStableUser }),
}));
jest.mock('@/context/currency', () => ({
  useCurrency: () => ({
    currency: { code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' },
  }),
  CURRENCIES: [{ code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' }],
}));
jest.mock('@/hooks/use-category-cache', () => ({
  useCategoryCache: () => ({
    detect: () => 'other',
    saveMapping: jest.fn(),
    reinforceMapping: jest.fn(),
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-image', () => ({
  Image: 'Image',
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// Current user is member-1; member-2 is Alex.
const mockMembers = [
  { id: 'member-1', display_name: null, avatar_url: null, user_id: 'user-1' },
  { id: 'member-2', display_name: 'Alex', avatar_url: null, user_id: 'user-2' },
];

let rpcMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  // Create mode: no expenseId.
  (useLocalSearchParams as jest.Mock).mockReturnValue({
    groupId: 'group-1',
    groupName: 'Bali Trip',
  });

  rpcMock = jest.fn().mockResolvedValue({ error: null });
  (supabase.rpc as jest.Mock) = rpcMock;

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'group_members') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockMembers, error: null }),
      };
    }
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
  });
});

/** Drives the create form into Exact mode with the given per-member base amounts. */
async function fillExactExpense(
  getByTestId: (id: string) => any,
  opts: { amount: string; extraPercent?: string; amounts: Record<string, string> },
) {
  await waitFor(() => {
    expect(getByTestId('amount-input')).toBeTruthy();
    // paid-by section renders only once members have finished loading
    expect(getByTestId('paid-by-section')).toBeTruthy();
  });

  fireEvent.changeText(getByTestId('description-input'), 'Group dinner');
  fireEvent.changeText(getByTestId('amount-input'), opts.amount);

  // Expand the split section, then switch to Exact amounts.
  fireEvent.press(getByTestId('split-summary-row'));
  fireEvent.press(getByTestId('split-method-exact'));

  // The tax % field is only available in Exact mode.
  if (opts.extraPercent) {
    fireEvent.press(getByTestId('add-extra-charge-button'));
    fireEvent.changeText(getByTestId('extra-charge-input'), opts.extraPercent);
  }

  // Override the auto-seeded per-person base amounts.
  for (const [memberId, value] of Object.entries(opts.amounts)) {
    fireEvent.changeText(getByTestId(`split-input-${memberId}`), value);
  }
}

test('exact split + tax: final-inclusive total split by pre-tax shares', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);

  // $105 final total (includes 5% tax). Pre-tax subtotal is $100, entered as
  // 40 / 60 per person. Tax is added back on top of each → 42 / 63, summing to
  // the $105 the user entered.
  await fillExactExpense(getByTestId, {
    amount: '105',
    extraPercent: '5',
    amounts: { 'member-1': '40', 'member-2': '60' },
  });

  await act(async () => {
    fireEvent.press(getByTestId('save-expense-button'));
  });

  await waitFor(() => {
    expect(rpcMock).toHaveBeenCalledWith(
      'create_expense_with_splits',
      expect.objectContaining({
        // Saved total = the final tax-inclusive amount the user entered.
        p_amount_cents: 10500,
        p_split_member_ids: ['member-1', 'member-2'],
        // Each pre-tax share scaled up to its share of the $105 total.
        p_split_amounts_cents: [4200, 6300],
      }),
    );
  });
});

test('exact split without extra charge: entered amounts pass through unchanged', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);

  await fillExactExpense(getByTestId, {
    amount: '100',
    amounts: { 'member-1': '40', 'member-2': '60' },
  });

  await act(async () => {
    fireEvent.press(getByTestId('save-expense-button'));
  });

  await waitFor(() => {
    expect(rpcMock).toHaveBeenCalledWith(
      'create_expense_with_splits',
      expect.objectContaining({
        p_amount_cents: 10000,
        p_split_member_ids: ['member-1', 'member-2'],
        p_split_amounts_cents: [4000, 6000],
      }),
    );
  });
});
