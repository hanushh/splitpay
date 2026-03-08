import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

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
  if (handlerConfigured) return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
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

  ensurePushNotificationHandler();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#17e86b',
    });
  }

  const existingPerms = await Notifications.getPermissionsAsync();
  let finalStatus = existingPerms.status;

  if (finalStatus !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = getProjectId();
  const tokenResult = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();

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
