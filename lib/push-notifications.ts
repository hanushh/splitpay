import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Lazy-load expo-notifications to prevent module-level crashes when the ExpoGo
// native module is unexpectedly present (e.g. emulator with Expo Go installed).
type NotificationsModule = typeof import('expo-notifications');
let _Notifications: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (_Notifications) return _Notifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Notifications = require('expo-notifications') as NotificationsModule;
    return _Notifications;
  } catch {
    return null;
  }
}

let handlerConfigured = false;

function getProjectId(): string | undefined {
  const envProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (envProjectId) return envProjectId;

  const constantsWithEas = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
  };

  return (
    constantsWithEas.easConfig?.projectId
    ?? constantsWithEas.expoConfig?.extra?.eas?.projectId
    ?? undefined
  );
}

export function ensurePushNotificationHandler() {
  const N = getNotifications();
  if (handlerConfigured || !N) return;
  handlerConfigured = true;

  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function registerPushTokenForCurrentUser(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) {
    return null;
  }

  const N = getNotifications();
  if (!N) return null;

  ensurePushNotificationHandler();

  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('default', {
      name: 'default',
      importance: N.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#17e86b',
    });
  }

  const existingPerms = await N.getPermissionsAsync();
  let finalStatus = existingPerms.status;

  if (finalStatus !== 'granted') {
    const requested = await N.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    return null;
  }
  const tokenResult = await N.getExpoPushTokenAsync({ projectId });

  const token = tokenResult.data;
  if (!token) return null;

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown';
  const deviceName = Device.modelName ?? null;

  const { error } = await supabase.rpc('upsert_push_token', {
    p_token: token,
    p_platform: platform,
    p_device_name: deviceName,
  });

  if (error) {
    console.warn('[Push] Failed to upsert push token:', error.message);
    return null;
  }

  return token;
}

export async function removePushToken(token: string | null): Promise<void> {
  if (!token) return;
  const { error } = await supabase.rpc('remove_push_token', { p_token: token });
  if (error) {
    console.warn('[Push] Failed to disable push token:', error.message);
  }
}

export async function dispatchPendingPushNotifications(): Promise<void> {
  const { error } = await supabase.functions.invoke('dispatch-push-notifications', {
    method: 'POST',
    body: {},
  });

  if (error) {
    console.warn('[Push] Failed to dispatch push notifications:', error.message);
  }
}
