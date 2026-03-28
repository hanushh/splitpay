import { NativeModule, requireNativeModule } from 'expo';

interface NativeTokenBridgeModule extends NativeModule {
  saveToken(token: string): void;
  clearToken(): void;
}

const NativeTokenBridge =
  requireNativeModule<NativeTokenBridgeModule>('NativeTokenBridge');

/**
 * Persists the Supabase access token to Android SharedPreferences so that
 * the App Functions service (running outside the JS thread) can authenticate
 * Supabase requests on behalf of the signed-in user.
 *
 * No-op on iOS and web (App Functions are Android-only).
 */
export function saveTokenForNative(token: string): void {
  try {
    NativeTokenBridge.saveToken(token);
  } catch {
    // Module not available on iOS/web — safe to ignore
  }
}

export function clearTokenForNative(): void {
  try {
    NativeTokenBridge.clearToken();
  } catch {
    // Module not available on iOS/web — safe to ignore
  }
}
