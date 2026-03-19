import * as Contacts from 'expo-contacts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/auth';

const C = {
  bg: '#112117',
  surface: '#1a3324',
  surfaceHL: '#244732',
  primary: '#17e86b',
  danger: '#ff5252',
  white: '#ffffff',
  slate400: '#94a3b8',
  slate500: '#64748b',
};

export default function SetupContactsScreen() {
  const { refreshContactsPermission } = useAuth();
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

      <Text style={s.title}>
        {denied ? 'Contacts Access Required' : 'Find friends on PaySplit'}
      </Text>

      <Text style={s.subtitle}>
        {denied
          ? 'PaySplit requires contacts access to find friends and match payments. Please enable it in Settings to continue.'
          : 'PaySplit uses your contacts to show which friends are already on the app and make splitting bills easier.'}
      </Text>

      {denied ? (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.btn,
            pressed && s.btnPressed,
          ]}
          onPress={() => Linking.openSettings()}
        >
          <Text style={s.btnText}>Open Settings</Text>
        </Pressable>
      ) : (
        <Pressable
          style={({ pressed }: { pressed: boolean }) => [
            s.btn,
            pressed && s.btnPressed,
          ]}
          onPress={handleAllow}
        >
          <Text style={s.btnText}>Allow Access</Text>
        </Pressable>
      )}
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
    paddingHorizontal: 32,
    gap: 0,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logoText: {
    color: C.bg,
    fontSize: 32,
    fontWeight: '800',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: C.white,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: C.slate400,
    marginBottom: 36,
    textAlign: 'center',
    lineHeight: 22,
  },
  btn: {
    height: 52,
    backgroundColor: C.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    alignSelf: 'stretch',
  },
  btnText: {
    color: C.bg,
    fontSize: 16,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.75,
  },
});
