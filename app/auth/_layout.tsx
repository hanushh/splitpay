import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="callback" />
      <Stack.Screen name="setup-phone" />
      <Stack.Screen name="setup-contacts" />
    </Stack>
  );
}
