import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { Redirect, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/auth';
import { CurrencyProvider } from '@/context/currency';
import SplashScreen from '@/components/SplashScreen';
import { supabase } from '@/lib/supabase';
import { initI18n } from '@/lib/i18n';

export const unstable_settings = {
  anchor: '(tabs)',
};

function InviteRedeemRedirect() {
  const { session, getPendingInviteToken, clearPendingInviteToken } = useAuth();
  const didRun = useRef(false);

  useEffect(() => {
    if (!session || didRun.current) return;
    didRun.current = true;
    (async () => {
      const token = await getPendingInviteToken();
      if (!token) return;
      const { data, error: redeemErr } = await supabase.rpc(
        'redeem_invitation_for_current_user',
        { p_token: token },
      );
      await clearPendingInviteToken();
      if (redeemErr) {
        Alert.alert(
          'Invite error',
          redeemErr.message ??
            'Failed to redeem your invite link. Please ask for a new one.',
        );
        return;
      }
      const row = Array.isArray(data) && data[0];
      if (row?.group_id_out) {
        router.replace({
          pathname: '/group/[id]',
          params: { id: row.group_id_out },
        });
      }
    })();
  }, [session, getPendingInviteToken, clearPendingInviteToken]);

  return null;
}

function RootNavigator() {
  const { session, loading, phoneComplete, contactsPermissionGranted } =
    useAuth();
  const colorScheme = useColorScheme();

  if (loading) {
    return (
      <>
        <StatusBar style="light" />
        <SplashScreen />
      </>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {session && !phoneComplete && <Redirect href="/auth/setup-phone" />}
      {session && phoneComplete && !contactsPermissionGranted && (
        <Redirect href="/auth/setup-contacts" />
      )}
      {session && <InviteRedeemRedirect />}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="group/balances" options={{ headerShown: false }} />
        <Stack.Screen name="group/spending" options={{ headerShown: false }} />
        <Stack.Screen
          name="add-expense"
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <Stack.Screen
          name="create-group"
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <Stack.Screen
          name="invite-friend"
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <Stack.Screen
          name="settle-up"
          options={{ headerShown: false, presentation: 'modal' }}
        />
        <Stack.Screen name="invite" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal' }}
        />
      </Stack>
      {!session && <Redirect href="/auth/sign-in" />}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) {
    return <SplashScreen />;
  }

  return (
    <CurrencyProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </CurrencyProvider>
  );
}
