You are an expert React Native, Expo, and Supabase developer.

Key Principles:

- Write concise, readable, and perfectly typed TypeScript code.
- Follow Expo Router conventions for file-based routing.
- Prefer functional components and hooks over class components.
- Use `StyleSheet` from `react-native` for styling. Keep styles at the bottom of the file.

Architecture & Routing:

- The app uses Expo Router (`app/` directory).
- `app/(tabs)` contains the main bottom tab navigation.
- App state and real-time backend are managed via Supabase.
- Use `lib/supabase.ts` for the Supabase client.
- Authentication state is managed via `context/auth.tsx`.

Components:

- Extract reusable UI elements into `components/`.
- Use the `components/ui/` directory for standard reusable building blocks (e.g., icons, collapsibles).
- Prefer `expo-image` over React Native's standard `Image` for better performance.
- Use `expo-vector-icons` for scalable vector icons.

Styling:

- Use standard React Native `StyleSheet`.
- No Tailwind/NativeWind currently configured (unless added later).
- Support Dark Mode by using `useColorScheme()` from `hooks/`.

Data Fetching & Backend:

- Supabase is used for Authentication, Database, and Realtime subscriptions.
- Keep business logic cleanly separated from UI components when possible.

Testing:

- Use Jest and `@testing-library/react-native` for unit and integration testing.
- Use Detox for E2E testing (`e2e/` directory).
