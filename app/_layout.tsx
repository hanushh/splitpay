import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/auth';
import { CurrencyProvider } from '@/context/currency';
import { APP_DISPLAY_NAME } from '@/lib/app-config';
import { supabase } from '@/lib/supabase';

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
      const { data } = await supabase.rpc('redeem_invitation_for_current_user', { p_token: token });
      await clearPendingInviteToken();
      const row = Array.isArray(data) && data[0];
      if (row?.group_id_out) {
        router.replace({ pathname: '/group/[id]', params: { id: row.group_id_out } });
      }
    })();
  }, [session, getPendingInviteToken, clearPendingInviteToken]);

  return null;
}

const LOADING_BG = '#112117';
const LOADING_FG = '#17e86b';

function RootNavigator() {
  const { session, loading } = useAuth();
  const colorScheme = useColorScheme();

  if (loading) {
    return (
      <View style={loadingStyles.container}>
        <StatusBar style="light" />
        <Text style={loadingStyles.title}>{APP_DISPLAY_NAME}</Text>
        <ActivityIndicator size="large" color={LOADING_FG} style={loadingStyles.spinner} />
        <Text style={loadingStyles.label}>Loading…</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {session && <InviteRedeemRedirect />}
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="group/balances" options={{ headerShown: false }} />
        <Stack.Screen name="add-expense" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="create-group" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="invite-friend" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="settle-up" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      {!session && <Redirect href="/auth/sign-in" />}
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LOADING_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: LOADING_FG,
    marginBottom: 24,
  },
  spinner: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#94a3b8',
  },
});

export default function RootLayout() {
  return (
    <CurrencyProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </CurrencyProvider>
  );
}
