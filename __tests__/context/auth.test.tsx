import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { AUTH_CALLBACK_URL, INVITE_LINK_PREFIX } from '@/lib/app-config';
import { removePushToken } from '@/lib/push-notifications';
import { router } from 'expo-router';

jest.mock('@/lib/supabase');
jest.mock('@/lib/push-notifications', () => ({
  registerPushTokenForCurrentUser: jest.fn().mockResolvedValue(null),
  removePushToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(),
  dismissBrowser: jest.fn(),
}));
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
      await result.current.signUp('new@example.com', 'password123', '+15550001234');
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
      response = await result.current.signUp('existing@example.com', 'pass', '+15550001234');
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

  it('signUp returns null error on success', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: 'not set' };
    await act(async () => {
      response = await result.current.signUp('new@example.com', 'password123', '+15550001234');
    });
    expect(response.error).toBeNull();
  });

  it('signOut calls removePushToken then supabase.auth.signOut', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.signOut();
    });
    expect(removePushToken).toHaveBeenCalled();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});

describe('useAuth — invite tokens', () => {
  it('getPendingInviteToken returns null when nothing stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    let token: string | null = 'initial';
    await act(async () => {
      token = await result.current.getPendingInviteToken();
    });
    expect(token).toBeNull();
  });

  it('getPendingInviteToken returns the stored token', async () => {
    // The getInitialURL effect will consume one call; set up a second for getPendingInviteToken
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('invite-abc');
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    let token: string | null = null;
    await act(async () => {
      token = await result.current.getPendingInviteToken();
    });
    expect(token).toBe('invite-abc');
  });

  it('clearPendingInviteToken calls SecureStore.deleteItemAsync', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});
    await act(async () => {
      await result.current.clearPendingInviteToken();
    });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pending_invite_token');
  });
});

describe('useAuth — deep link handling', () => {
  it('invite deep link stores token in SecureStore', async () => {
    const inviteUrl = `${INVITE_LINK_PREFIX}?token=deeplink-token-xyz`;
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(inviteUrl);

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'pending_invite_token',
        'deeplink-token-xyz',
      );
    });
  });

  it('auth callback deep link with code exchanges session and navigates', async () => {
    const callbackUrl = `${AUTH_CALLBACK_URL}?code=deeplink-code-123`;
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(callbackUrl);
    (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValueOnce({
      data: { session: { access_token: 'tok' }, user: { id: 'test-user-id' } },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { phone: '+11234567890' }, error: null }),
    });

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('deeplink-code-123');
      expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    });
  });

  it('invite deep link with no token is a no-op', async () => {
    const inviteUrl = `${INVITE_LINK_PREFIX}?foo=bar`;
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(inviteUrl);

    renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('auth callback deep link with implicit tokens sets session and navigates', async () => {
    const callbackUrl = `${AUTH_CALLBACK_URL}#access_token=myat&refresh_token=myrt`;
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(callbackUrl);
    (supabase.auth.setSession as jest.Mock).mockResolvedValueOnce({
      data: { session: { access_token: 'myat' }, user: { id: 'test-user-id' } },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { phone: '+11234567890' }, error: null }),
    });

    renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(supabase.auth.setSession).toHaveBeenCalledWith({
        access_token: 'myat',
        refresh_token: 'myrt',
      });
      expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    });
  });

  it('ignores deep links that do not match known prefixes', async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce('paysplit://unknown/path');

    renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
