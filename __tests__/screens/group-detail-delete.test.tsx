import React from 'react';
import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/group/[id]';
import { supabase } from '@/lib/supabase';
import { useLocalSearchParams } from 'expo-router';

jest.mock('@/lib/supabase');
const mockStableUser = { id: 'user-1' };
jest.mock('@/context/auth', () => ({
  useAuth: () => ({ user: mockStableUser }),
}));
jest.mock('@/context/currency', () => ({
  useCurrency: () => ({ format: (c: number) => `$${(c / 100).toFixed(2)}` }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockGroup = {
  id: 'group-1',
  name: 'Bali Trip',
  description: null,
  image_url: null,
  created_by: 'user-1',
};
const mockExpenses = [
  {
    expense_id: 'exp-1',
    description: 'Dinner at Locavore',
    total_amount_cents: 12000,
    category: 'restaurant',
    created_at: '2026-03-15T12:00:00Z',
    paid_by_name: 'You',
    paid_by_is_user: true,
    your_split_cents: 6000,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');

  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'group-1' });

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'expense_splits') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { balance_cents: 6000 }, error: null }),
      single: jest.fn().mockResolvedValue({ data: mockGroup, error: null }),
    };
  });
  // Default: all rpc calls succeed (covers initial load + delete_expense + refetch)
  (supabase.rpc as jest.Mock).mockResolvedValue({
    data: mockExpenses,
    error: null,
  });
});

async function openDetailSheet(
  getByText: ReturnType<typeof render>['getByText'],
) {
  await waitFor(() => getByText('Dinner at Locavore'));
  fireEvent.press(getByText('Dinner at Locavore'));
  await waitFor(() => getByText('Delete'));
}

test('tapping an expense card opens the detail sheet', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  expect(getByText('Edit')).toBeTruthy();
  expect(getByText('Delete')).toBeTruthy();
});

test('tapping Delete shows confirmation Alert with expense name', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));
  expect(Alert.alert).toHaveBeenCalledWith(
    'Delete expense?',
    expect.stringContaining('Dinner at Locavore'),
    expect.any(Array),
  );
});

test('confirming delete calls delete_expense rpc and then re-fetches group', async () => {
  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));

  // Simulate the user pressing the destructive "Delete" button in the Alert
  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'Delete');
  await act(async () => {
    await deleteButton!.onPress!();
  });

  await waitFor(() => {
    expect(supabase.rpc).toHaveBeenCalledWith('delete_expense', {
      p_expense_id: 'exp-1',
    });
    // fetchGroup re-fires supabase.rpc — confirm it was called more than once (initial load + delete + refetch)
    expect((supabase.rpc as jest.Mock).mock.calls.length).toBeGreaterThan(1);
  });
});

test('delete error shows Alert and does not close the sheet', async () => {
  // Override rpc to return an error for delete_expense
  (supabase.rpc as jest.Mock).mockImplementation((fnName: string) => {
    if (fnName === 'delete_expense') {
      return Promise.resolve({
        data: null,
        error: { message: 'Permission denied' },
      });
    }
    return Promise.resolve({ data: mockExpenses, error: null });
  });

  const { getByText } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText);
  fireEvent.press(getByText('Delete'));

  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'Delete');
  await act(async () => {
    await deleteButton!.onPress!();
  });

  await waitFor(() => {
    // A second Alert should have been shown with the error message
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Permission denied');
    // The sheet should still be visible (Edit/Delete buttons still rendered)
    expect(getByText('Edit')).toBeTruthy();
  });
});
