# CLAUDE.md – SplitPay AI Assistant Guide

This file provides Claude Code and other AI assistants with the context needed to contribute effectively to this codebase.

---

## Project Overview

**SplitPay** (published as "PaySplit") is a React Native mobile application for splitting bills among friends and groups. Users can create groups, add shared expenses, view per-person balances, and settle up.

- **App name**: PaySplit
- **Bundle ID**: `com.hanushh.paysplit`
- **Deep-link scheme**: `paysplit://`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native 0.81.5 + Expo ~54 |
| Routing | Expo Router ~6 (file-based) |
| Backend / DB | Supabase (Postgres, Auth, Realtime, Edge Functions) |
| Language | TypeScript 5.9 (strict mode) |
| Styling | React Native `StyleSheet` |
| Unit tests | Jest 30 + `@testing-library/react-native` |
| E2E tests | Detox 20 (Android emulator) |
| Linting | ESLint 9 (flat config, `eslint-config-expo`) |
| Formatting | Prettier 3 |
| CI/CD | GitHub Actions → Google Play |

---

## Repository Structure

```
splitpay/
├── app/                        # Expo Router pages (file-based routing)
│   ├── _layout.tsx             # Root layout: Stack + AuthProvider + CurrencyProvider
│   ├── (tabs)/                 # Bottom tab navigator
│   │   ├── _layout.tsx
│   │   ├── index.tsx           # Groups overview (home)
│   │   ├── activity.tsx        # Recent activity feed
│   │   ├── friends.tsx         # Cross-group friend balances
│   │   └── account.tsx         # Profile / settings
│   ├── auth/                   # Auth stack
│   │   ├── sign-in.tsx
│   │   ├── sign-up.tsx
│   │   └── callback.tsx        # OAuth & deep-link callback
│   ├── group/
│   │   ├── [id].tsx            # Group detail screen
│   │   └── balances.tsx        # Per-member balances in a group
│   ├── add-expense.tsx         # Modal: add an expense
│   ├── create-group.tsx        # Modal: create a group
│   ├── invite-friend.tsx       # Modal: invite a friend
│   └── settle-up.tsx           # Modal: settle balances
├── components/
│   └── ui/                     # Generic reusable building blocks
├── context/
│   ├── auth.tsx                # Auth state (Supabase session)
│   └── currency.tsx            # Selected display currency
├── hooks/                      # Custom hooks (useGroups, useColorScheme, …)
├── lib/
│   ├── supabase.ts             # Supabase client (single export)
│   ├── database.types.ts       # Auto-generated Supabase DB types
│   ├── push-notifications.ts   # Push token registration helpers
│   └── app-config.ts           # Shared app config constants
├── supabase/
│   ├── migrations/             # SQL migration files (numbered)
│   └── functions/
│       └── dispatch-push-notifications/  # Deno edge function
├── __tests__/                  # Jest unit tests
├── e2e/                        # Detox E2E tests (*.e2e.ts)
├── constants/                  # Theme colors and fonts
├── scripts/                    # Build helper scripts
├── .agents/workflows/          # Step-by-step task workflows for AI agents
├── .cursorrules                # Coding rules for AI IDEs
├── ARCHITECTURE.md             # Architecture deep-dive
├── CONTRIBUTING.md             # PR checklist and conventions
└── llms.txt                    # Short tech-stack summary for LLMs
```

---

## Development Setup

### Prerequisites
- Node.js 20+
- Android Studio (for Android emulator / device)
- Xcode (macOS, for iOS simulator)

### Install and run

> **Package manager:** This project uses `pnpm` exclusively. Always prefer `pnpm` over `npm` or `yarn` for installing dependencies and running scripts (CI uses pnpm 9).

```bash
pnpm install          # Install dependencies
pnpm dev              # Start Expo dev server
```

### Environment variables

Create `.env.local` (or `.env.production` for release builds):

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

---

## Key Scripts

```bash
pnpm dev                 # Expo dev server
pnpm build:android       # Local Android AAB release build
pnpm lint                # ESLint
pnpm format              # Prettier check
pnpm format:fix          # Prettier write (auto-fix)
pnpm typecheck           # tsc --noEmit
pnpm test                # Jest unit tests
pnpm test:coverage       # Jest with coverage report
pnpm test:watch          # Jest watch mode
pnpm e2e:build           # Build debug APK for Detox
pnpm e2e:test            # Run Detox tests (android.emu.debug)
pnpm e2e:test:release    # Detox on release build
pnpm e2e:test:auth       # Detox – auth tests only
```

---

## Pre-PR Checklist

Before committing or raising a PR, all of the following must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Run additionally when applicable:
- **E2E tests** – when UI flows change: `pnpm e2e:build && pnpm e2e:test`
- **Android build** – when native/Android-specific code changes: `pnpm build:android`

---

## Coding Conventions

### TypeScript
- Strict mode is enabled — no `any`, no implicit returns.
- Define explicit interfaces/types for all component props and hook return values.
- DB types live in `lib/database.types.ts`; regenerate when schema changes (see `.agents/workflows/update-supabase-types.md`).

### Components
- **Functional components only** — no class components.
- Export the component as the **default export**.
- Props must have a strict TypeScript interface.
- Use `expo-image` (not RN `Image`) for all image rendering.
- Use `IconSymbol` from `components/ui/icon-symbol.tsx` or `expo-vector-icons` for icons.

### Styling
- Use `StyleSheet.create(...)` from `react-native` — **no inline styles** unless values are dynamic/calculated.
- Place the `const styles = StyleSheet.create(...)` block **at the bottom** of each file.
- No Tailwind / NativeWind (not configured).
- Support dark and light modes via `useColorScheme()` from `@/hooks/use-color-scheme`.

### Color palette (constants/colors)

```typescript
primary:    '#17e86b'   // Green CTA
primaryDark:'#0ea64c'
danger:     '#ff5252'   // Errors / destructive
bg:         '#112117'   // Dark background
surface:    '#1a3324'   // Card background
surfaceHL:  '#244732'   // Highlighted surface
orange:     '#f97316'   // Secondary accent
white:      '#ffffff'
```

### File naming
- **Screens** (routes): `kebab-case.tsx` (e.g., `sign-in.tsx`, `add-expense.tsx`)
- **Components**: `PascalCase.tsx` (e.g., `GroupCard.tsx`)
- **Hooks**: `camelCase.ts` prefixed with `use` (e.g., `useGroups.ts`)
- **Utilities / lib**: `kebab-case.ts`

### Import alias
- `@/*` resolves to the project root (configured in `tsconfig.json`).
- Prefer `@/lib/supabase`, `@/context/auth`, `@/hooks/use-color-scheme`, etc.

---

## Architecture Patterns

### Data fetching (custom hooks)

Extract all Supabase data access into custom hooks under `hooks/`. The standard pattern:

```typescript
export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('groups').select('...');
      if (error) throw error;
      setGroups(data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  return { groups, loading, error, refetch: fetchGroups };
}
```

- Screens consume hooks; they do **not** call Supabase directly.
- Business logic that is not component-specific goes in `lib/` or `hooks/`.

### Authentication

- `context/auth.tsx` is the single source of truth for auth state.
- Screens use `useAuth()` from that context — never call `supabase.auth` directly in screens.
- Auth methods: email/password and Google OAuth (PKCE via `expo-web-browser`).
- Tokens are persisted with `expo-secure-store`.

### Navigation (Expo Router)
- Routes are defined by the file system in `app/`.
- Modals must be registered in `app/_layout.tsx` with `presentation: 'modal'`.
- Deep links use the `paysplit://` scheme (OAuth callback, group invite redemption).

### State management summary
| Concern | Mechanism |
|---|---|
| Auth session | React Context (`context/auth.tsx`) |
| Display currency | React Context (`context/currency.tsx`) |
| Group / expense data | Custom hooks + Supabase |
| Local UI state | `useState` in component |

---

## Database (Supabase)

### Core tables
- `profiles` — extended user profiles
- `groups` — group records
- `group_members` — membership (nullable `user_id` for external contacts)
- `expenses` — expense records (amounts stored in **cents**)
- `expense_splits` — per-member splits for each expense
- `group_balances` — computed per-user, per-group balance (positive = owed to user)
- `invitations` — token-based invites (7-day expiry)
- `user_push_tokens` — registered device tokens
- `user_notifications` — notification delivery queue

### Important RPC functions (called from client)
- `get_group_expenses(p_group_id, p_user_id)` — expenses with user's share
- `get_group_member_balances(p_group_id, p_user_id)` — who owes what
- `get_friend_balances(p_user_id)` — consolidated cross-group balances
- `get_user_activity(p_user_id, p_limit)` — activity feed
- `create_expense_with_splits(...)` — atomic expense + splits insert
- `redeem_invitation_for_current_user(p_token)` — accept group invite
- `upsert_push_token / remove_push_token` — manage device tokens
- `initialize_demo_data(p_user_id)` — seed demo data on signup

### RLS
All tables have Row Level Security. Users can only read/write data in groups they belong to.

### Schema changes
After any migration, regenerate TypeScript types:
```bash
# See .agents/workflows/update-supabase-types.md for full steps
```

---

## Testing

### Unit tests (Jest)
- Config: `jest.config.js` using `jest-expo` preset.
- Test files: `__tests__/` directory, or co-located as `*.test.tsx`.
- Supabase is mocked via `lib/__mocks__/supabase.ts`.
- `expo-secure-store` and `expo-router` are mocked in tests.

### E2E tests (Detox)
- Android emulator: `Pixel_9_Pro` (configured in `.detoxrc.js`).
- Test files: `e2e/*.e2e.ts`.
- Covers: auth, create-group, add-expense flows.

---

## Adding New Screens

Follow `.agents/workflows/create-screen.md`. Key steps:
1. Place file in correct directory (`app/(tabs)/` for tabs, `app/` for standalone, modal for modals).
2. Functional component, TypeScript (`.tsx`), default export.
3. `StyleSheet.create(...)` at the bottom.
4. Use `useColorScheme()` for theme support.
5. Wrap content in `SafeAreaView` if needed.
6. Register in `app/_layout.tsx` if it's a new modal or standalone route.

## Adding New UI Components

Follow `.agents/workflows/create-ui-component.md`. Key steps:
1. Generic building blocks → `components/ui/`; feature-specific → `components/`.
2. Strict TypeScript props interface.
3. `StyleSheet.create(...)` at the bottom.
4. Use `expo-image` for images, `IconSymbol` or `expo-vector-icons` for icons.
5. Handle dark/light theme via `useColorScheme()`.

---

## CI/CD

Pipeline: `.github/workflows/google-play-release.yml`

**Trigger**: push to `main`, `beta`, `alpha`, or `internal` branches.

**Steps**: lint → typecheck → unit tests → Android AAB build → sign → upload to Google Play.

| Branch | Play Store track |
|---|---|
| `main` | production |
| `beta` | beta |
| `alpha` | alpha |
| `internal` | internal |

**Required GitHub secrets**: `ANDROID_SIGNING_KEY`, `ANDROID_ALIAS`, `ANDROID_KEY_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `PLAY_STORE_CREDENTIALS_JSON`.

---

## Agent Workflows

Reusable step-by-step task guides live in `.agents/workflows/`:

| File | Purpose |
|---|---|
| `create-screen.md` | Add a new screen/route |
| `create-ui-component.md` | Create a reusable component |
| `run-lint.md` | Run ESLint |
| `run-typecheck.md` | Run TypeScript compiler |
| `run-unit-tests.md` | Run Jest tests |
| `run-e2e.md` | Run Detox E2E tests |
| `update-supabase-types.md` | Regenerate DB types after schema change |
| `update-dependencies.md` | Update npm dependencies safely |
| `verify-android-build.md` | Build and verify Android release locally |

---

## Related Documentation

- `ARCHITECTURE.md` — Detailed architecture and routing patterns
- `CONTRIBUTING.md` — PR checklist and coding conventions
- `.cursorrules` — Concise coding rules for AI IDEs
- `llms.txt` — Short tech-stack summary
- `AI.md` — Brief AI context pointer file
