import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';

/**
 * Handles the OAuth redirect from Supabase (scheme://auth/callback?code=...).
 * With WebBrowser.openAuthSessionAsync the browser intercepts the redirect
 * before this screen is reached, but this serves as a fallback for edge cases.
 */
export default function AuthCallbackScreen() {
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

      if (params.code) {
        await supabase.auth.exchangeCodeForSession(params.code);
      }

      router.replace('/(tabs)');
    };

    handleCallback();
  }, [params.code, params.error]);

  return (
    <View style={s.container}>
      <ActivityIndicator color="#17e86b" size="large" />
      <Text style={s.text}>Signing you in…</Text>
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
