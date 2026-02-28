import { Session, User } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useContext, useEffect, useState } from 'react';
import { AUTH_CALLBACK_URL, AUTH_LINK_PREFIX, INVITE_LINK_PREFIX } from '@/lib/app-config';
import { supabase } from '@/lib/supabase';

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
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
        } catch (_) {}
        return;
      }

      if (!url.startsWith(AUTH_LINK_PREFIX)) return;

      WebBrowser.dismissBrowser();

      try {
        const parsed = new URL(event.url);

        // PKCE flow: exchange code for session
        const code = parsed.searchParams.get('code');
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
          return;
        }

        // Implicit flow fallback: parse tokens from hash
        const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        }
      } catch (err) {
        console.error('[Auth] Deep link handling error:', err);
      }
    };

    Linking.getInitialURL().then((url) => { if (url) handleDeepLink({ url }); });
    const subscription = Linking.addEventListener('url', handleDeepLink);
    return () => subscription.remove();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const redirectTo = 'splitwise://auth/callback';
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

    // Open the browser. Session is established via the Linking listener above
    // when Supabase redirects to AUTH_CALLBACK_URL
    await WebBrowser.openBrowserAsync(data.url);
    return { error: null };
  };

  const signOut = async () => {
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
