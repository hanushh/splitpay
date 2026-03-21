import { Session, User } from '@supabase/supabase-js';
import * as Contacts from 'expo-contacts';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AUTH_CALLBACK_PATH,
  AUTH_CALLBACK_URL,
  INVITE_LINK_PREFIX,
  INVITE_WEB_LINK_BASE,
} from '@/lib/app-config';
import { normalizePhone } from '@/lib/phone';
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
  phoneComplete: boolean;
  contactsPermissionGranted: boolean;
  signIn: (
    emailOrPhone: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    phone: string,
  ) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshPhoneComplete: () => Promise<void>;
  refreshContactsPermission: () => Promise<void>;
  pendingInviteToken: string | null;
  getPendingInviteToken: () => Promise<string | null>;
  clearPendingInviteToken: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  phoneComplete: true,
  contactsPermissionGranted: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signInWithGoogle: async () => ({ error: null }),
  signOut: async () => {},
  refreshPhoneComplete: async () => {},
  refreshContactsPermission: async () => {},
  pendingInviteToken: null,
  getPendingInviteToken: async () => null,
  clearPendingInviteToken: async () => {},
});

async function fetchPhoneComplete(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('phone')
    .eq('id', userId)
    .single();
  return !!(data?.phone as string | null)?.trim();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneComplete, setPhoneComplete] = useState(true);
  const [contactsPermissionGranted, setContactsPermissionGranted] =
    useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const activePushToken = useRef<string | null>(null);
  const handlingOAuthCallback = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
    }, 12000); // If getSession doesn't resolve in 12s (e.g. no network), show sign-in

    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (cancelled) return;
        setSession(session);
        if (session?.user?.id) {
          const [complete, { status }] = await Promise.all([
            fetchPhoneComplete(session.user.id),
            Contacts.getPermissionsAsync(),
          ]);
          if (!cancelled) {
            setPhoneComplete(complete);
            setContactsPermissionGranted(
              status === Contacts.PermissionStatus.GRANTED,
            );
          }
        }
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
      // Invite: paysplit://invite?token=xxx  OR  https://<domain>/invite?token=xxx
      // Store the token for redemption after the user authenticates.
      const isInviteDeepLink = url.startsWith(INVITE_LINK_PREFIX);
      const isInviteWebLink =
        INVITE_WEB_LINK_BASE !== '' && url.startsWith(INVITE_WEB_LINK_BASE);
      if (isInviteDeepLink || isInviteWebLink) {
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('token');
          if (token) {
            await SecureStore.setItemAsync(INVITE_TOKEN_KEY, token);
            setPendingInviteToken(token);
          }
        } catch {}
        return;
      }

      // Handle only OAuth callback deep links, not every /auth route.
      // Match both the production scheme (paysplit://) and Expo Go (exp://).
      const callbackPath = AUTH_CALLBACK_PATH; // 'auth/callback'
      const isOAuthCallback =
        url.startsWith(AUTH_CALLBACK_URL) ||
        url.includes(`/--/${callbackPath}`);
      if (!isOAuthCallback) return;
      // signInWithGoogle handles the callback itself via openAuthSessionAsync;
      // skip here to avoid exchanging the one-time PKCE code twice on Android.
      if (handlingOAuthCallback.current) return;

      WebBrowser.dismissBrowser();

      try {
        const parsed = new URL(event.url);

        // PKCE flow: exchange code for session
        const code = parsed.searchParams.get('code');
        if (code) {
          const { data: codeData } =
            await supabase.auth.exchangeCodeForSession(code);
          if (codeData.user?.id) await navigatePostAuth(codeData.user.id);
          return;
        }

        // Implicit flow fallback: parse tokens from hash
        const hash = parsed.hash.startsWith('#')
          ? parsed.hash.slice(1)
          : parsed.hash;
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          const { data: sessionData } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionData.user?.id) await navigatePostAuth(sessionData.user.id);
        }
      } catch (err) {
        console.error('[Auth] Deep link handling error:', err);
      }
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });
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

  useEffect(() => {
    const userId = session?.user?.id;
    const email = session?.user?.email;
    if (!userId || !email) return;

    let cancelled = false;
    (async () => {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email_hash')
          .eq('id', userId)
          .single();

        if (cancelled || profile?.email_hash) return;

        const { digestStringAsync, CryptoDigestAlgorithm } =
          await import('expo-crypto');
        const hash = await digestStringAsync(
          CryptoDigestAlgorithm.SHA256,
          email.toLowerCase().trim(),
        );
        if (!cancelled) {
          await supabase
            .from('profiles')
            .update({ email_hash: hash })
            .eq('id', userId);
        }
      } catch {
        // Non-fatal: hash will be set on next session load
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session?.user?.email]);

  const navigatePostAuth = async (userId: string) => {
    const [complete, { status }] = await Promise.all([
      fetchPhoneComplete(userId),
      Contacts.getPermissionsAsync(),
    ]);
    setPhoneComplete(complete);
    const contactsGranted = status === Contacts.PermissionStatus.GRANTED;
    setContactsPermissionGranted(contactsGranted);
    if (!complete) {
      router.replace('/auth/setup-phone');
    } else if (!contactsGranted) {
      router.replace('/auth/setup-contacts');
    } else {
      router.replace('/(tabs)');
    }
  };

  const refreshPhoneComplete = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const complete = await fetchPhoneComplete(userId);
    setPhoneComplete(complete);
  };

  const refreshContactsPermission = async () => {
    const { status } = await Contacts.getPermissionsAsync();
    setContactsPermissionGranted(status === Contacts.PermissionStatus.GRANTED);
  };

  const signIn = async (emailOrPhone: string, password: string) => {
    let email = emailOrPhone.trim();
    // If input doesn't look like an email, treat it as a phone number
    if (!email.includes('@')) {
      const normalized = normalizePhone(email);
      if (!normalized) return { error: 'Enter a valid email or phone number.' };
      const { data: lookedUpEmail, error: lookupErr } = await supabase.rpc(
        'get_email_by_phone',
        { p_phone: normalized },
      );
      if (lookupErr) return { error: lookupErr.message };
      if (!lookedUpEmail)
        return { error: 'No account found with that phone number.' };
      email = lookedUpEmail as string;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error: error.message };
    if (data.user?.id) await navigatePostAuth(data.user.id);
    return { error: null };
  };

  const signUp = async (email: string, password: string, phone: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // Save phone to profile immediately (profile row is created by DB trigger on auth.users insert)
    if (data.user?.id && phone) {
      await supabase.from('profiles').update({ phone }).eq('id', data.user.id);
    }
    return { error: null };
  };

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    // Linking.createURL returns the correct scheme for the current environment:
    // 'exp://...' in Expo Go, 'paysplit://auth/callback' in native builds.
    const redirectTo = Linking.createURL(AUTH_CALLBACK_PATH);
    console.log('[Auth] Google sign-in redirectTo:', redirectTo);
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
    handlingOAuthCallback.current = true;
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    console.log('[Auth] openAuthSessionAsync result type:', result.type);
    if (result.type !== 'success' || !result.url) {
      console.log(
        '[Auth] Browser dismissed or failed - relying on deep link handler',
      );
      handlingOAuthCallback.current = false;
      return { error: null };
    }

    console.log('[Auth] result.url:', result.url.substring(0, 80));
    try {
      const parsed = new URL(result.url);
      const code = parsed.searchParams.get('code');
      if (code) {
        const { data: codeData, error: exchangeErr } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) {
          console.error(
            '[Auth] exchangeCodeForSession error:',
            exchangeErr.message,
          );
          return { error: exchangeErr.message };
        }
        handlingOAuthCallback.current = false;
        if (codeData.user?.id) await navigatePostAuth(codeData.user.id);
        return { error: null };
      }

      const hash = parsed.hash.startsWith('#')
        ? parsed.hash.slice(1)
        : parsed.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { data: sessionData, error: sessionErr } =
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        if (sessionErr) return { error: sessionErr.message };
        handlingOAuthCallback.current = false;
        if (sessionData.user?.id) await navigatePostAuth(sessionData.user.id);
        return { error: null };
      }
    } catch (err) {
      console.error('[Auth] OAuth callback parse error:', err);
      handlingOAuthCallback.current = false;
      return { error: 'Failed to finish Google sign-in.' };
    }

    handlingOAuthCallback.current = false;
    return {
      error: 'Google sign-in callback did not include auth credentials.',
    };
  };

  const signOut = async () => {
    await clearCategoryCache();
    await removePushToken(activePushToken.current);
    activePushToken.current = null;
    await supabase.auth.signOut();
  };

  const getPendingInviteToken = async () =>
    SecureStore.getItemAsync(INVITE_TOKEN_KEY);
  const clearPendingInviteToken = async () => {
    setPendingInviteToken(null);
    await SecureStore.deleteItemAsync(INVITE_TOKEN_KEY);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        phoneComplete,
        contactsPermissionGranted,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        refreshPhoneComplete,
        refreshContactsPermission,
        pendingInviteToken,
        getPendingInviteToken,
        clearPendingInviteToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
