import * as Contacts from 'expo-contacts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/auth';

const C = {
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  primary: '#17e86b',
  danger: '#ff5252',
  white: '#ffffff',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
};

export default function SetupContactsScreen() {
  const { refreshContactsPermission } = useAuth();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState(false);
  const appState = useRef(AppState.currentState);

  // Auto-advance if permission already granted (e.g. re-install, returning from Settings)
  useEffect(() => {
    Contacts.getPermissionsAsync().then(async ({ status }) => {
      if (status === Contacts.PermissionStatus.GRANTED) {
        await refreshContactsPermission();
        router.replace('/(tabs)');
      } else {
        setChecking(false);
      }
    });
  }, [refreshContactsPermission]);

  // Re-check when the user returns from the Settings app
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextState: string) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextState === 'active'
        ) {
          const { status } = await Contacts.getPermissionsAsync();
          if (status === Contacts.PermissionStatus.GRANTED) {
            await refreshContactsPermission();
            router.replace('/(tabs)');
          }
        }
        appState.current = nextState;
      },
    );
    return () => subscription.remove();
  }, [refreshContactsPermission]);

  const handleAllow = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status === Contacts.PermissionStatus.GRANTED) {
      await refreshContactsPermission();
      router.replace('/(tabs)');
    } else {
      setDenied(true);
    }
  };

  if (checking) {
    return (
      <View style={[s.container, s.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (denied) {
    return (
      <View
        style={[
          s.container,
          s.centered,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <View style={s.logoMark}>
          <Text style={s.logoText}>S</Text>
        </View>
        <Text style={s.title}>{t('setupContacts.titleDenied')}</Text>
        <Text style={s.subtitle}>{t('setupContacts.subtitleDenied')}</Text>
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.btn,
            pressed && s.btnPressed,
          ]}
          onPress={() => Linking.openSettings()}
        >
          <Text style={s.btnText}>{t('setupContacts.openSettings')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.logoMark}>
          <Text style={s.logoText}>S</Text>
        </View>

        <Text style={s.title}>{t('setupContacts.titleDefault')}</Text>
        <Text style={s.subtitle}>{t('setupContacts.subtitleDefault')}</Text>

        {/* Prominent Data Disclosure — required before contacts permission */}
        <View style={s.disclosureCard}>
          <Text style={s.disclosureCardTitle}>
            {t('setupContacts.disclosureCardTitle')}
          </Text>

          <View style={s.disclosureRow}>
            <Text style={s.disclosureRowLabel}>
              {t('setupContacts.disclosureRowNameLabel')}
            </Text>
            <Text style={s.disclosureRowValue}>
              {t('setupContacts.disclosureRowNameValue')}
            </Text>
          </View>

          <View style={s.divider} />

          <View style={s.disclosureRow}>
            <Text style={s.disclosureRowLabel}>
              {t('setupContacts.disclosureRowEmailLabel')}
            </Text>
            <Text style={s.disclosureRowValue}>
              {t('setupContacts.disclosureRowEmailValue')}
            </Text>
          </View>

          <View style={s.divider} />

          <View style={s.disclosureRow}>
            <Text style={s.disclosureRowLabel}>
              {t('setupContacts.disclosureRowPhoneLabel')}
            </Text>
            <Text style={s.disclosureRowValue}>
              {t('setupContacts.disclosureRowPhoneValue')}
            </Text>
          </View>
        </View>

        <Text style={s.purposeNote}>{t('setupContacts.purposeNote')}</Text>

        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.btn,
            pressed && s.btnPressed,
          ]}
          onPress={handleAllow}
        >
          <Text style={s.btnText}>{t('setupContacts.allowAccess')}</Text>
        </Pressable>

        <Text style={s.skipNote}>{t('setupContacts.skipNote')}</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 32,
    gap: 0,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoText: {
    color: C.bg,
    fontSize: 32,
    fontWeight: '800',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.white,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: C.slate400,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Prominent disclosure card
  disclosureCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    alignSelf: 'stretch',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.surfaceHL,
  },
  disclosureCardTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: C.slate400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  disclosureRow: {
    paddingVertical: 10,
    gap: 4,
  },
  disclosureRowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.white,
  },
  disclosureRowValue: {
    fontSize: 13,
    color: C.slate400,
    lineHeight: 19,
  },
  divider: {
    height: 1,
    backgroundColor: C.surfaceHL,
  },
  purposeNote: {
    fontSize: 12,
    color: C.slate500,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  btn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    alignSelf: 'stretch',
    marginBottom: 14,
  },
  btnText: {
    color: C.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.75,
  },
  skipNote: {
    fontSize: 12,
    color: C.slate500,
    textAlign: 'center',
    lineHeight: 18,
  },
});
