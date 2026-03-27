import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Handles the OAuth redirect from Supabase (scheme://auth/callback?code=...).
 * With WebBrowser.openAuthSessionAsync the browser intercepts the redirect
 * before this screen is reached, but this serves as a fallback for edge cases.
 */
export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  useEffect(() => {
    const handleCallback = async () => {
      if (params.error) {
        router.replace('/auth/sign-in');
        return;
      }

      try {
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) {
            console.error('[AuthCallback] Code exchange failed:', error.message);
            router.replace('/auth/sign-in');
            return;
          }
        }
        router.replace('/(tabs)');
      } catch (err) {
        console.error('[AuthCallback] Unexpected error:', err);
        router.replace('/auth/sign-in');
      }
    };

    handleCallback();
  }, [params.code, params.error]);

  return (
    <View style={s.container}>
      <ActivityIndicator color="#17e86b" size="large" />
      <Text style={s.text}>{t('auth.signingIn')}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#112117',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    color: '#94a3b8',
    fontSize: 15,
  },
});
