## Splitpay Architecture

### Overview

Splitpay is a React Native mobile app built with Expo Router and Supabase. Routing is file-based in the `app` directory, data and authentication are handled via Supabase, and reusable UI is organized under `components/`.

### Routing and Navigation (Expo Router)

- **Entry point**: `app/_layout.tsx` defines the root `Stack` and global screen options.
- **Tabs**: `app/(tabs)/_layout.tsx` defines the bottom tab navigator:
  - `app/(tabs)/index.tsx` – main dashboard / groups overview
  - `app/(tabs)/activity.tsx` – recent activity
  - `app/(tabs)/friends.tsx` – friends / contacts
  - `app/(tabs)/account.tsx` – account and settings
- **Auth flow**:
  - `app/auth/_layout.tsx` – auth stack layout
  - `app/auth/sign-in.tsx`, `app/auth/sign-up.tsx` – authentication screens
  - `app/auth/callback.tsx` – OAuth or deep link callback handling
- **Core flows**:
  - `app/create-group.tsx` – create a group
  - `app/add-expense.tsx` – add an expense to a group
  - `app/settle-up.tsx` – settle balances between members
  - `app/group/[id].tsx` – group details
  - `app/group/balances.tsx` – group balances
- **Modals**:
  - `app/modal.tsx` – example modal route; additional modals should follow Expo Router modal conventions.

When adding new screens, follow the existing patterns and use `.agents/workflows/create-screen.md` as the step-by-step reference.

### Supabase Integration

- **Client**: `lib/supabase.ts` exports a configured Supabase client used throughout the app.
- **Types**: `lib/database.types.ts` contains generated types for the database schema.
  - When the schema changes, regenerate types using `.agents/workflows/update-supabase-types.md`.
- **Auth state**:
  - `context/auth.tsx` manages authentication state and provides auth context/hooks to the rest of the app.
  - Screens should consume auth via this context instead of talking to Supabase auth directly.

### Data & Business Logic

- Prefer keeping **business logic out of screen components** where possible:
  - Extract reusable logic into helpers under `lib/` or custom hooks under `hooks/`.
  - Keep screens focused on composition, navigation, and wiring up hooks.
- Use Supabase queries/mutations through thin wrappers or hooks (e.g. `useGroups`, `useGroupBalances`) to keep data access consistent and type-safe.

### Components and Styling

- **UI components**:
  - Reusable building blocks go under `components/ui/`.
  - More feature-specific components can live under `components/` in subfolders.
- **Images & icons**:
  - Use `expo-image` instead of React Native `Image`.
  - Use `expo-vector-icons` or `IconSymbol` from `components/ui/icon-symbol.tsx` for icons.
- **Styling**:
  - Use `StyleSheet` from `react-native`.
  - Keep `StyleSheet.create(...)` at the bottom of each file.
  - Support dark/light mode using `useColorScheme()` from `hooks/`.

### Testing

- **Unit/integration tests**:
  - Use Jest and `@testing-library/react-native`.
  - Place tests alongside components or under a `__tests__` directory, following your team’s convention.
- **End-to-end tests**:
  - Use Detox with the scripts:
    - `npm run e2e:build`
    - `npm run e2e:test`
  - See `.agents/workflows/run-e2e.md` for the full workflow.

### Build and Release

- Local Android release builds:
  - `npm run build:android` (see `.agents/workflows/verify-android-build.md`).
- CI/CD:
  - `.github/workflows/google-play-release.yml` builds the Android app bundle and uploads it to Google Play for the `com.hanushh.paysplit` package.

