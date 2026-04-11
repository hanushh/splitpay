import { Redirect } from 'expo-router';

/**
 * Catch-all for paysplit://invite?token=xxx deep links.
 * The token is already captured by the deep link handler in context/auth.tsx
 * and stored in SecureStore. This screen simply redirects to the home tab
 * so Expo Router doesn't show an "Unmatched Route" error.
 */
export default function InviteCatchAll() {
  return <Redirect href="/(tabs)" />;
}
