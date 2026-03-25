/**
 * Platform-safe key-value storage.
 *
 * Uses `expo-secure-store` on native and `localStorage` on web.
 * Import this instead of `expo-secure-store` directly so that web
 * never crashes from the missing native module.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return (globalThis as any).localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    (globalThis as any).localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    (globalThis as any).localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
