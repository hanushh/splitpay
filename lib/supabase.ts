import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import * as ExpoCrypto from 'expo-crypto';

// Polyfill global.crypto for Supabase PKCE (getRandomValues / randomUUID).
// expo-crypto provides the native implementation; we expose it as the Web
// Crypto API so that @supabase/auth-js can generate code verifiers.
if (typeof global.crypto === 'undefined') {
  // @ts-expect-error – attaching to global
  global.crypto = {
    getRandomValues: <T extends ArrayBufferView>(array: T): T =>
      ExpoCrypto.getRandomValues(
        array as unknown as Uint8Array,
      ) as unknown as T,
    randomUUID: () =>
      ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
  };
}

// SecureStore has a ~2048-byte value limit. Large Supabase session JWTs can
// exceed this, silently dropping writes and breaking PKCE token retrieval.
// This adapter chunks values that exceed the safe limit.
const CHUNK_SIZE = 1800;

const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const numChunksStr = await SecureStore.getItemAsync(`${key}__n`);
    if (numChunksStr !== null) {
      const n = parseInt(numChunksStr, 10);
      const chunks: string[] = [];
      for (let i = 0; i < n; i++) {
        const chunk = await SecureStore.getItemAsync(`${key}__${i}`);
        if (chunk === null) return null;
        chunks.push(chunk);
      }
      return chunks.join('');
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      // Clean up any stale chunks from a previous large write
      const stale = await SecureStore.getItemAsync(`${key}__n`);
      if (stale !== null) {
        const n = parseInt(stale, 10);
        await SecureStore.deleteItemAsync(`${key}__n`);
        for (let i = 0; i < n; i++)
          await SecureStore.deleteItemAsync(`${key}__${i}`);
      }
    } else {
      const n = Math.ceil(value.length / CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}__n`, String(n));
      for (let i = 0; i < n; i++) {
        await SecureStore.setItemAsync(
          `${key}__${i}`,
          value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
      }
      // Remove the plain key in case a small value was stored there before
      await SecureStore.deleteItemAsync(key);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    await SecureStore.deleteItemAsync(key);
    const numChunksStr = await SecureStore.getItemAsync(`${key}__n`);
    if (numChunksStr !== null) {
      const n = parseInt(numChunksStr, 10);
      await SecureStore.deleteItemAsync(`${key}__n`);
      for (let i = 0; i < n; i++)
        await SecureStore.deleteItemAsync(`${key}__${i}`);
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
