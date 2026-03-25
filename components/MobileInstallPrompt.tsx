import { useState, useEffect } from 'react';
import { Platform, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APP_STORE_URL } from '@/lib/app-config';

const DISMISSED_KEY = 'paysplit_install_prompt_dismissed';

type MobilePlatform = 'android' | 'ios' | null;

function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return null;
}

function isRunningAsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari sets navigator.standalone
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  // Standard PWA display-mode check
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

export default function MobileInstallPrompt() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (isRunningAsStandalone()) return;

    const dismissed =
      (globalThis as { localStorage?: Storage }).localStorage?.getItem(DISMISSED_KEY);
    if (dismissed === '1') return;

    const platform = detectMobilePlatform();
    if (!platform) return;

    setMobilePlatform(platform);
    setVisible(true);
  }, []);

  if (!visible || !mobilePlatform) return null;

  function handleDismiss() {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  }

  function handleInstall() {
    if (mobilePlatform === 'android') {
      Linking.openURL(APP_STORE_URL);
    }
    // For iOS, the banner itself explains what to do — no deep link needed.
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.emoji}>
          {mobilePlatform === 'android' ? '🤖' : '🍎'}
        </Text>
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {mobilePlatform === 'android'
              ? t('installPrompt.androidTitle')
              : t('installPrompt.iosTitle')}
          </Text>
          <Text style={styles.subtitle}>
            {mobilePlatform === 'android'
              ? t('installPrompt.androidSubtitle')
              : t('installPrompt.iosSubtitle')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {mobilePlatform === 'android' && (
          <Pressable style={styles.installButton} onPress={handleInstall}>
            <Text style={styles.installButtonText}>
              {t('installPrompt.getApp')}
            </Text>
          </Pressable>
        )}
        <Pressable style={styles.dismissButton} onPress={handleDismiss}>
          <Text style={styles.dismissText}>{t('installPrompt.dismiss')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a3324',
    borderTopWidth: 1,
    borderTopColor: '#244732',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 28,
    zIndex: 9999,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  emoji: {
    fontSize: 28,
    marginRight: 12,
    marginTop: 2,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  installButton: {
    flex: 1,
    backgroundColor: '#17e86b',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  installButtonText: {
    color: '#112117',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#244732',
    alignItems: 'center',
  },
  dismissText: {
    color: '#94a3b8',
    fontSize: 14,
  },
});
