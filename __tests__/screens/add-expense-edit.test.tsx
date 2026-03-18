import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import AddExpenseScreen from '@/app/add-expense';
import { supabase } from '@/lib/supabase';
import { router, useLocalSearchParams } from 'expo-router';

jest.mock('@/lib/supabase');
const mockStableUser = { id: 'user-1' };
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: mockStableUser }),
}));
jest.mock('@/context/currency', () => ({
  useCurrency: () => ({ currency: { code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' } }),
  CURRENCIES: [{ code: 'USD', flag: '🇺🇸', symbol: '$', name: 'US Dollar' }],
}));
jest.mock('@/hooks/use-category-cache', () => ({
  useCategoryCache: () => ({ detect: () => 'other', saveMapping: jest.fn(), reinforceMapping: jest.fn() }),
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

const mockExpenseRow = {
  id: 'expense-1',
  description: 'Dinner at Locavore',
  amount_cents: 12000,
  paid_by_member_id: 'member-2',
  category: 'restaurant',
  receipt_url: null,
};

const mockSplitRows = [
  { member_id: 'member-1' },
  { member_id: 'member-2' },
];

const mockMembers = [
  { id: 'member-1', display_name: null, avatar_url: null, user_id: 'user-1' },
  { id: 'member-2', display_name: 'Alex', avatar_url: null, user_id: 'user-2' },
];

// Track calls to each table for save-path assertions
let updateMock: jest.Mock;
let splitsDeleteMock: jest.Mock;
let splitsInsertMock: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  (useLocalSearchParams as jest.Mock).mockReturnValue({
    groupId: 'group-1',
    groupName: 'Bali Trip',
    expenseId: 'expense-1',
  });

  updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  splitsDeleteMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  splitsInsertMock = jest.fn().mockResolvedValue({ error: null });

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'group_members') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockMembers, error: null }),
      };
    }
    if (table === 'expenses') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockExpenseRow, error: null }),
        update: updateMock,
      };
    }
    if (table === 'expense_splits') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: mockSplitRows, error: null }),
        delete: splitsDeleteMock,
        insert: splitsInsertMock,
      };
    }
    if (table === 'profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) };
  });
});

test('edit mode: description pre-populated from fetched expense', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
  });
});

test('edit mode: amount pre-populated as display string', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('amount-input').props.value).toBe('120.00');
  });
});

test('edit mode: group selector is locked (no testID group-picker-button)', async () => {
  const { queryByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(queryByTestId('group-picker-button')).toBeNull();
    expect(queryByTestId('group-locked-row')).not.toBeNull();
  });
});

test('edit mode: header shows "Edit expense"', async () => {
  const { getByText } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByText('Edit expense')).toBeTruthy();
  });
});

test('edit mode: paidBy is set from fetched paid_by_member_id (member-2), not defaulted to current user (member-1)', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  // Wait for members and expense data to load — both description AND paid-by section
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
    expect(getByTestId('paid-by-section')).toBeTruthy();
  });
  // The paid-by section should show Alex (member-2), not You (member-1/current user)
  const paidBySection = getByTestId('paid-by-section');
  expect(paidBySection).toBeTruthy();
  // The compactRowValueText inside paid-by-section shows the payer name
  expect(paidBySection).toHaveTextContent('Alex', { exact: false });
});

test('edit mode: save calls UPDATE then DELETE splits then INSERT splits', async () => {
  const { getByTestId } = render(<AddExpenseScreen />);
  await waitFor(() => {
    expect(getByTestId('description-input').props.value).toBe('Dinner at Locavore');
  });
  fireEvent.press(getByTestId('save-expense-button'));
  await waitFor(() => {
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(splitsDeleteMock).toHaveBeenCalledTimes(1);
    expect(splitsInsertMock).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
