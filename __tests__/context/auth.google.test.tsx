import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AuthProvider, useAuth } from '@/context/auth';
import { AUTH_CALLBACK_URL } from '@/lib/app-config';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase');
jest.mock('@/lib/push-notifications', () => ({
  registerPushTokenForCurrentUser: jest.fn().mockResolvedValue(null),
  removePushToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(),
  dismissBrowser: jest.fn(),
}));
jest.mock('expo-linking', () => ({
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn().mockResolvedValue(null),
  createURL: jest.fn().mockReturnValue('paysplit://auth/callback'),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('Google auth smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
      data: { url: 'https://mock-oauth-url.com' },
      error: null,
    });
  });

  it('opens auth session and returns cancel error when user cancels', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'cancel',
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: AUTH_CALLBACK_URL,
        skipBrowserRedirect: true,
      },
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://mock-oauth-url.com',
      AUTH_CALLBACK_URL,
    );
    expect(response.error).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('handles callback code and navigates to tabs on success', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?code=oauth-code-123`,
    });
    (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: 'init' };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('oauth-code-123');
    expect(response.error).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('returns error when signInWithOAuth fails', async () => {
    (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValueOnce({
      data: { url: null },
      error: { message: 'OAuth provider error' },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(response.error).toBe('OAuth provider error');
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('returns error when signInWithOAuth returns no URL', async () => {
    (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValueOnce({
      data: { url: null },
      error: null,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(response.error).toBe('Failed to start Google sign-in');
  });

  it('returns error when exchangeCodeForSession fails', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?code=bad-code`,
    });
    (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid code' },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(response.error).toBe('Invalid code');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('handles implicit flow (hash-based tokens) and navigates to tabs', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}#access_token=my-access&refresh_token=my-refresh`,
    });
    (supabase.auth.setSession as jest.Mock).mockResolvedValueOnce({
      data: { session: { access_token: 'my-access' } },
      error: null,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: 'init' };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'my-access',
      refresh_token: 'my-refresh',
    });
    expect(response.error).toBeNull();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('returns error when implicit flow setSession fails', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}#access_token=tok&refresh_token=ref`,
    });
    (supabase.auth.setSession as jest.Mock).mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Session error' },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(response.error).toBe('Session error');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('returns error when callback has no auth credentials', async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: `${AUTH_CALLBACK_URL}?state=abc`,
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    let response: { error: string | null } = { error: null };

    await act(async () => {
      response = await result.current.signInWithGoogle();
    });

    expect(response.error).toBe('Google sign-in callback did not include auth credentials.');
  });
});
