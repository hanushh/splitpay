import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(), dismissBrowser: jest.fn() }));
jest.mock('expo-linking', () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  createURL: jest.fn((path: string) => `paysplit://${path}`),
  getInitialURL: jest.fn().mockResolvedValue(null),
  parse: jest.fn().mockReturnValue({ path: '', queryParams: {} }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

beforeEach(() => jest.clearAllMocks());

describe('useAuth', () => {
  it('starts with no session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('signIn calls supabase.auth.signInWithPassword', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signIn('test@example.com', 'password123');
    });
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password123',
    });
  });

  it('signIn returns error message on failure', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
      data: {},
      error: { message: 'Invalid credentials' },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };
    await act(async () => {
      response = await result.current.signIn('bad@example.com', 'wrong');
    });
    expect(response.error).toBe('Invalid credentials');
  });

  it('signIn returns null error on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: 'not set' };
    await act(async () => {
      response = await result.current.signIn('test@example.com', 'password123');
    });
    expect(response.error).toBeNull();
  });

  it('signUp calls supabase.auth.signUp', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signUp('new@example.com', 'password123');
    });
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
    });
  });

  it('signUp returns error on failure', async () => {
    (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
      data: {},
      error: { message: 'Email already in use' },
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };
    await act(async () => {
      response = await result.current.signUp('existing@example.com', 'pass');
    });
    expect(response.error).toBe('Email already in use');
  });

  it('signOut calls supabase.auth.signOut', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('loading is false after init', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    expect(result.current.loading).toBe(false);
  });
});
