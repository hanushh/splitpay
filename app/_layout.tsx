import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native';
import { Redirect, Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState, useEffect } from 'react';
import { Alert, Platform } from 'react-native';

import { useTranslation } from 'react-i18next';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/context/auth';
import { CurrencyProvider } from '@/context/currency';
import { OnboardingProvider } from '@/context/onboarding';
import { ToastProvider, useToast } from '@/context/toast';
import SplashScreen from '@/components/SplashScreen';
import MobileInstallPrompt from '@/components/MobileInstallPrompt';
import { supabase } from '@/lib/supabase';
import { initI18n } from '@/lib/i18n';
import { PostHogProvider, getPostHogClient, analytics, AnalyticsEvents } from '@/lib/analytics';
import { ensurePushNotificationHandler } from '@/lib/push-notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

function InviteRedeemRedirect() {
  const { session, pendingInviteToken, clearPendingInviteToken } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();

  useEffect(() => {
    if (!session || !pendingInviteToken) return;
    (async () => {
      const { data, error: redeemErr } = await supabase.rpc(
        'redeem_invitation_for_current_user',
        { p_token: pendingInviteToken },
      );
      if (redeemErr) {
        Alert.alert(
          t('invite.redeemError'),
          redeemErr.message ?? t('invite.redeemFailed'),
        );
        return;
      }
      await clearPendingInviteToken();
      const row = Array.isArray(data) && data[0];
      if (row?.group_id_out) {
        analytics.track(AnalyticsEvents.INVITE_ACCEPTED, {
          group_id: row.group_id_out,
        });
        showToast('success', t('toast.inviteRedeemed'));
        router.replace({
          pathname: '/group/[id]',
          params: { id: row.group_id_out },
        });
      }
    })();
  }, [session, pendingInviteToken, clearPendingInviteToken, showToast]);

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
      {session && phoneComplete && !contactsPermissionGranted && Platform.OS !== 'web' && (
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
      <MobileInstallPrompt />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
    // Configure foreground notification display as early as possible
    if (Platform.OS !== 'web') {
      ensurePushNotificationHandler();
    }
  }, []);

  if (!i18nReady) {
    return <SplashScreen />;
  }

  const posthogClient = getPostHogClient();

  return (
    <PostHogProvider
      client={posthogClient ?? undefined}
      {...(!posthogClient && { apiKey: 'disabled', options: { disabled: true } })}
    >
      <CurrencyProvider>
        <AuthProvider>
          <OnboardingProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </OnboardingProvider>
        </AuthProvider>
      </CurrencyProvider>
    </PostHogProvider>
  );
}
