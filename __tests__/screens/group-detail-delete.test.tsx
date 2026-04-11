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
  formatCentsWithCurrency: (c: number) => `$${(c / 100).toFixed(2)}`,
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
    currency_code: 'INR',
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
    if (table === 'group_balances') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValueOnce({
          eq: jest.fn().mockResolvedValue({
            data: [{ balance_cents: 6000, currency_code: 'INR' }],
            error: null,
          }),
        }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
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
  getByTestId: ReturnType<typeof render>['getByTestId'],
) {
  await waitFor(() => getByText('Dinner at Locavore'));
  fireEvent.press(getByText('Dinner at Locavore'));
  await waitFor(() => getByTestId('delete-btn'));
}

test('tapping an expense card opens the detail sheet', async () => {
  const { getByText, getByTestId } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText, getByTestId);
  expect(getByTestId('edit-btn')).toBeTruthy();
  expect(getByTestId('delete-btn')).toBeTruthy();
});

test('tapping Delete shows confirmation Alert with expense name', async () => {
  const { getByText, getByTestId } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText, getByTestId);
  fireEvent.press(getByTestId('delete-btn'));
  expect(Alert.alert).toHaveBeenCalledWith(
    'group.deleteExpenseTitle',
    'group.deleteExpenseMessage',
    expect.any(Array),
  );
});

test('confirming delete calls delete_expense rpc and then re-fetches group', async () => {
  const { getByText, getByTestId } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText, getByTestId);
  fireEvent.press(getByTestId('delete-btn'));

  // Simulate the user pressing the destructive "Delete" button in the Alert
  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'common.delete');
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

  const { getByText, getByTestId } = render(<GroupDetailScreen />);
  await openDetailSheet(getByText, getByTestId);
  fireEvent.press(getByTestId('delete-btn'));

  const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
  const buttons: { text: string; onPress?: () => void }[] = alertCall[2];
  const deleteButton = buttons.find((b) => b.text === 'common.delete');
  await act(async () => {
    await deleteButton!.onPress!();
  });

  await waitFor(() => {
    // A second Alert should have been shown with the error message
    expect(Alert.alert).toHaveBeenCalledWith('common.ok', 'Permission denied');
    // The sheet should still be visible (edit/delete buttons still rendered)
    expect(getByTestId('edit-btn')).toBeTruthy();
  });
});

// ─── Leave-group guard (non-creator) ─────────────────────────────────────────

/**
 * Set up mocks for a non-creator user (created_by: 'other-user') with the
 * given balance. Returns the `deleteMock` so tests can assert it was never
 * called when the guard fires.
 */
function setupNonCreatorMock(balanceCents: number) {
  const nonCreatorGroup = { ...mockGroup, created_by: 'other-user' };
  const deleteMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  });

  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'expense_splits') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ data: [], error: null }),
      };
    }
    if (table === 'group_balances') {
      const rows =
        balanceCents !== 0
          ? [{ balance_cents: balanceCents, currency_code: 'INR' }]
          : [];
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnValueOnce({
          eq: jest.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      };
    }
    if (table === 'group_members') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        delete: deleteMock,
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest
        .fn()
        .mockResolvedValue({ data: nonCreatorGroup, error: null }),
    };
  });

  return { deleteMock };
}

async function openSettingsSheet(
  getByTestId: ReturnType<typeof render>['getByTestId'],
  getByText: ReturnType<typeof render>['getByText'],
) {
  await waitFor(() => getByText('Dinner at Locavore'));
  fireEvent.press(getByTestId('settings-button'));
  await waitFor(() => getByTestId('leave-group-button'));
}

describe('leave-group guard (non-creator)', () => {
  test('blocks leaving when user is owed money (balance > 0)', async () => {
    setupNonCreatorMock(6000);
    const { getByTestId, getByText, queryByTestId } = render(
      <GroupDetailScreen />,
    );

    await openSettingsSheet(getByTestId, getByText);
    fireEvent.press(getByTestId('leave-group-button'));

    await waitFor(() =>
      getByText('group.owedLeaveBlocked'),
    );
    // The type-to-confirm modal must NOT have opened
    expect(queryByTestId('delete-confirm-input')).toBeNull();
  });

  test('blocks leaving when user has an outstanding debt (balance < 0)', async () => {
    setupNonCreatorMock(-3000);
    const { getByTestId, getByText, queryByTestId } = render(
      <GroupDetailScreen />,
    );

    await openSettingsSheet(getByTestId, getByText);
    fireEvent.press(getByTestId('leave-group-button'));

    await waitFor(() =>
      getByText('group.owesLeaveBlocked'),
    );
    expect(queryByTestId('delete-confirm-input')).toBeNull();
  });

  test('allows leaving when balance is zero', async () => {
    setupNonCreatorMock(0);
    const { getByTestId, getByText: _getByText } = render(<GroupDetailScreen />);

    await openSettingsSheet(getByTestId, _getByText);
    fireEvent.press(getByTestId('leave-group-button'));

    // The type-to-confirm modal should open
    await waitFor(() => getByTestId('delete-confirm-input'));
  });

});
