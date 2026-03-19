// __tests__/components/ExpenseDetailSheet.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import ExpenseDetailSheet from '@/components/ExpenseDetailSheet';

// ── shared fixtures ──────────────────────────────────────────────────────────

const mockExpense = {
  expense_id: 'exp-1',
  description: 'Dinner at Locavore',
  total_amount_cents: 12000,
  category: 'restaurant',
  created_at: '2026-03-15T12:00:00Z',
  paid_by_name: 'You',
  paid_by_is_user: true,
  your_split_cents: 6000,
};

const mockMembers = [
  { id: 'mem-1', display_name: 'You',   avatar_url: null, user_id: 'user-1' },
  { id: 'mem-2', display_name: 'Arjun', avatar_url: null, user_id: 'user-2' },
];

const mockSplits = [
  { member_id: 'mem-1', amount_cents: 6000 },
  { member_id: 'mem-2', amount_cents: 6000 },
];

const baseProps = {
  expense: mockExpense,
  splits: mockSplits,
  splitsLoading: false,
  deletingExpense: false,
  members: mockMembers,
  currentUserId: 'user-1',
  isArchived: false,
  onClose: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  format: (c: number) => `$${(c / 100).toFixed(2)}`,
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

// ── tests ────────────────────────────────────────────────────────────────────

test('renders nothing when expense is null', () => {
  const { queryByText } = render(<ExpenseDetailSheet {...baseProps} expense={null} />);
  expect(queryByText('Dinner at Locavore')).toBeNull();
});

test('renders expense title, total, and paid-by name', () => {
  const { getByText } = render(<ExpenseDetailSheet {...baseProps} />);
  expect(getByText('Dinner at Locavore')).toBeTruthy();
  expect(getByText('$120.00')).toBeTruthy();
  expect(getByText('You')).toBeTruthy();
});

test('renders skeleton rows when splitsLoading is true', () => {
  const { getAllByTestId } = render(
    <ExpenseDetailSheet {...baseProps} splits={[]} splitsLoading={true} />
  );
  expect(getAllByTestId('split-skeleton').length).toBe(3);
});

test('renders member rows with correct amounts when splits are provided', () => {
  const { getByText, getAllByText } = render(<ExpenseDetailSheet {...baseProps} />);
  expect(getByText('Arjun')).toBeTruthy();
  // Both members have $60.00
  expect(getAllByText('$60.00').length).toBeGreaterThanOrEqual(1);
});

test('hides Edit and Delete actions when isArchived is true', () => {
  const { queryByText } = render(<ExpenseDetailSheet {...baseProps} isArchived={true} />);
  expect(queryByText('Edit')).toBeNull();
  expect(queryByText('Delete')).toBeNull();
});

test('shows ActivityIndicator on Delete when deletingExpense is true', () => {
  const { queryByText, getByTestId } = render(
    <ExpenseDetailSheet {...baseProps} deletingExpense={true} />
  );
  expect(queryByText('Delete')).toBeNull();
  expect(getByTestId('delete-loading')).toBeTruthy();
});

test('calls onEdit when Edit is pressed', () => {
  const onEdit = jest.fn();
  const { getByText } = render(<ExpenseDetailSheet {...baseProps} onEdit={onEdit} />);
  fireEvent.press(getByText('Edit'));
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('calls onDelete when Delete is pressed', () => {
  const onDelete = jest.fn();
  const { getByText } = render(<ExpenseDetailSheet {...baseProps} onDelete={onDelete} />);
  fireEvent.press(getByText('Delete'));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('shows "Unknown" for a split whose member_id is not in members array', () => {
  const splitsWithUnknown = [
    { member_id: 'mem-1', amount_cents: 6000 },
    { member_id: 'mem-999', amount_cents: 6000 }, // not in mockMembers
  ];
  const { getByText } = render(<ExpenseDetailSheet {...baseProps} splits={splitsWithUnknown} />);
  expect(getByText('Unknown')).toBeTruthy();
});
