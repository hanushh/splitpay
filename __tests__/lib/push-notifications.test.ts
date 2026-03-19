import {
  removePushToken,
  dispatchPendingPushNotifications,
  ensurePushNotificationHandler,
  registerPushTokenForCurrentUser,
} from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

jest.mock('@/lib/supabase');

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest
    .fn()
    .mockResolvedValue({ data: 'ExponentPushToken[test-token]' }),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('expo-device', () => ({
  isDevice: true,
  modelName: 'Test Device',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    easConfig: { projectId: 'test-project-id' },
    expoConfig: { extra: { eas: { projectId: 'test-project-id' } } },
  },
}));

beforeEach(() => jest.clearAllMocks());

describe('removePushToken', () => {
  it('is a no-op when token is null', async () => {
    await removePushToken(null);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('calls remove_push_token RPC with the token', async () => {
    await removePushToken('ExponentPushToken[abc]');
    expect(supabase.rpc).toHaveBeenCalledWith('remove_push_token', {
      p_token: 'ExponentPushToken[abc]',
    });
  });

  it('resolves even when RPC returns an error', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Token not found' },
    });
    await expect(removePushToken('bad-token')).resolves.toBeUndefined();
  });
});

describe('dispatchPendingPushNotifications', () => {
  it('calls the dispatch-push-notifications edge function', async () => {
    await dispatchPendingPushNotifications();
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      'dispatch-push-notifications',
      { method: 'POST', body: {} },
    );
  });

  it('resolves even when the edge function returns an error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge function failed' },
    });
    await expect(dispatchPendingPushNotifications()).resolves.toBeUndefined();
  });
});

describe('ensurePushNotificationHandler', () => {
  it('configures the notification handler on first call', () => {
    ensurePushNotificationHandler();
    expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
  });
});

describe('registerPushTokenForCurrentUser', () => {
  it('returns null on web platform', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    const result = await registerPushTokenForCurrentUser();
    Platform.OS = original;
    expect(result).toBeNull();
  });

  it('returns null when permissions are denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
    });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
    });
    const result = await registerPushTokenForCurrentUser();
    expect(result).toBeNull();
  });

  it('registers token and returns it on success', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const result = await registerPushTokenForCurrentUser();
    expect(result).toBe('ExponentPushToken[test-token]');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'upsert_push_token',
      expect.objectContaining({
        p_token: 'ExponentPushToken[test-token]',
      }),
    );
  });

  it('returns null when upsert_push_token RPC fails', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Upsert failed' },
    });
    const result = await registerPushTokenForCurrentUser();
    expect(result).toBeNull();
  });

  it('returns null when no push token is returned', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValueOnce({
      data: null,
    });
    const result = await registerPushTokenForCurrentUser();
    expect(result).toBeNull();
  });
});
