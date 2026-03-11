import { Image, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { APP_DISPLAY_NAME } from '@/lib/app-config';

const BRAND_BG = '#112117';
const BRAND_PRIMARY = '#17e86b';
const BRAND_SECONDARY = '#94a3b8';

interface SplashScreenProps {
  loadingText?: string;
}

export default function SplashScreen({ loadingText = 'Loading…' }: SplashScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <Image
          source={require('@/assets/images/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        {/* App Name */}
        <Text style={styles.appName}>{APP_DISPLAY_NAME}</Text>

        {/* Loading Spinner */}
        <View style={styles.spinnerContainer}>
          <ActivityIndicator size="large" color={BRAND_PRIMARY} />
        </View>

        {/* Loading Text */}
        <Text style={styles.loadingText}>{loadingText}</Text>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Settling expenses made simple</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 32,
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: BRAND_PRIMARY,
    marginBottom: 48,
    letterSpacing: 0.5,
  },
  spinnerContainer: {
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 14,
    color: BRAND_SECONDARY,
    fontWeight: '500',
  },
  footer: {
    paddingBottom: 48,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: BRAND_SECONDARY,
    fontStyle: 'italic',
  },
});
