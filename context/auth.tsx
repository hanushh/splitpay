import { Session, User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AUTH_CALLBACK_URL, INVITE_LINK_PREFIX } from '@/lib/app-config';
import {
  registerPushTokenForCurrentUser,
  removePushToken,
} from '@/lib/push-notifications';
import { clearCategoryCache } from '@/hooks/use-category-cache';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const INVITE_TOKEN_KEY = 'pending_invite_token';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  getPendingInviteToken: () => Promise<string | null>;
  clearPendingInviteToken: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signInWithGoogle: async () => ({ error: null }),
  signOut: async () => {},
  getPendingInviteToken: async () => null,
  clearPendingInviteToken: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const activePushToken = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
    }, 12000); // If getSession doesn't resolve in 12s (e.g. no network), show sign-in

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setSession(session);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  // Handle deep links: auth callback and invite
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const url = event.url;
      // Invite: scheme://invite?token=xxx — store token for post-auth redeem
      if (url.startsWith(INVITE_LINK_PREFIX)) {
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('token');
          if (token) await SecureStore.setItemAsync(INVITE_TOKEN_KEY, token);
        } catch {}
        return;
      }

      // Handle only OAuth callback deep links, not every /auth route.
      if (!url.startsWith(AUTH_CALLBACK_URL)) return;

      WebBrowser.dismissBrowser();

      try {
        const parsed = new URL(event.url);

        // PKCE flow: exchange code for session
        const code = parsed.searchParams.get('code');
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
          router.replace('/(tabs)');
          return;
        }

        // Implicit flow fallback: parse tokens from hash
        const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          router.replace('/(tabs)');
        }
      } catch (err) {
        console.error('[Auth] Deep link handling error:', err);
      }
    };

    Linking.getInitialURL().then((url) => { if (url) handleDeepLink({ url }); });
    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      activePushToken.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const token = await registerPushTokenForCurrentUser();
      if (!cancelled) {
        activePushToken.current = token;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const redirectTo = AUTH_CALLBACK_URL;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      return { error: error?.message ?? 'Failed to start Google sign-in' };
    }

    // Use AuthSession so the redirect callback is reliably captured in-app.
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return { error: 'Google sign-in was cancelled or did not complete.' };
    }

    try {
      const parsed = new URL(result.url);
      const code = parsed.searchParams.get('code');
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) return { error: exchangeErr.message };
        router.replace('/(tabs)');
        return { error: null };
      }

      const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionErr) return { error: sessionErr.message };
        router.replace('/(tabs)');
        return { error: null };
      }
    } catch (err) {
      console.error('[Auth] OAuth callback parse error:', err);
      return { error: 'Failed to finish Google sign-in.' };
    }

    return { error: 'Google sign-in callback did not include auth credentials.' };
  };

  const signOut = async () => {
    await clearCategoryCache();
    await removePushToken(activePushToken.current);
    activePushToken.current = null;
    await supabase.auth.signOut();
  };

  const getPendingInviteToken = async () => SecureStore.getItemAsync(INVITE_TOKEN_KEY);
  const clearPendingInviteToken = async () => SecureStore.deleteItemAsync(INVITE_TOKEN_KEY);

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signIn, signUp, signInWithGoogle, signOut, getPendingInviteToken, clearPendingInviteToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
