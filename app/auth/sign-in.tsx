import { AntDesign } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';
import { APP_DISPLAY_NAME } from '@/lib/app-config';

const C = {
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  primary: '#17e86b',
  primaryDark: '#0ea64c',
  danger: '#ff5252',
  white: '#ffffff',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
};

export default function SignInScreen() {
  const { signIn, signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSignIn = async () => {
    if (!emailOrPhone || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setError(null);
    setLoading(true);
    const { error } = await signIn(emailOrPhone, password);
    setLoading(false);
    if (error) setError(error);
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);
    if (error) setError(error);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[
        s.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={s.inner}>
        <View style={s.logoMark}>
          <Text style={s.logoText}>S</Text>
        </View>
        <Text style={s.title}>Welcome back</Text>
        <Text style={s.subtitle}>Sign in to {APP_DISPLAY_NAME}</Text>

        {error && <Text style={s.errorText}>{error}</Text>}

        {/* Google Sign In */}
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.googleBtn,
            (googleLoading || pressed) && s.btnPressed,
          ]}
          onPress={handleGoogleSignIn}
          disabled={googleLoading || loading}
        >
          {googleLoading ? (
            <ActivityIndicator color={C.slate500} size="small" />
          ) : (
            <>
              <AntDesign name="google" size={20} color="#EA4335" />
              <Text style={s.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {/* Divider */}
        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.dividerLine} />
        </View>

        <TextInput
          style={s.input}
          placeholder="Email or phone number"
          placeholderTextColor={C.slate500}
          autoCapitalize="none"
          keyboardType="email-address"
          value={emailOrPhone}
          onChangeText={setEmailOrPhone}
          testID="email-input"
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor={C.slate500}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          testID="password-input"
        />

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.signInBtn,
            (loading || pressed) && s.btnPressed,
          ]}
          onPress={handleSignIn}
          disabled={loading || googleLoading}
          testID="sign-in-button"
        >
          {loading ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <Text style={s.signInBtnText}>Sign In</Text>
          )}
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerText}>Don&apos;t have an account? </Text>
          <Link href="/auth/sign-up" style={s.link}>
            Sign Up
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    alignSelf: 'center',
  },
  logoText: {
    color: C.bg,
    fontSize: 32,
    fontWeight: '800',
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: C.white,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: C.slate400,
    marginBottom: 32,
    textAlign: 'center',
  },
  errorText: {
    color: C.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  googleBtn: {
    height: 52,
    backgroundColor: C.white,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnText: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.75,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.surfaceHL,
  },
  dividerText: {
    color: C.slate500,
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: C.surfaceHL,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: C.white,
    backgroundColor: C.surface,
    marginBottom: 14,
  },
  signInBtn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  signInBtnText: {
    color: C.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerText: {
    color: C.slate400,
    fontSize: 14,
  },
  link: {
    color: C.primary,
    fontSize: 14,
    fontWeight: '600',
  },
});
