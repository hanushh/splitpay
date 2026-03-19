# Multi-lingual Support (Hindi) — Design Spec

**Date:** 2026-03-16
**Status:** Approved
**Branch:** `feat/i18n-hindi` (new branch off `main`)

---

## Overview

Add internationalization (i18n) infrastructure to PaySplit using `i18next`, with Hindi as the first additional language. The system is designed for extensibility — adding a new language requires only a JSON translation file and one config entry.

## Goals

- Support English (default) and Hindi
- Auto-detect language from device locale on first launch
- Allow manual language selection in Account settings
- Build extensible infrastructure for future languages
- AI-generate Hindi translations for user review

## Non-Goals (Out of Scope)

- RTL layout support (Hindi is LTR; needed only for Arabic/Urdu)
- Date/number locale formatting (follow-up task)
- Server-side translations (push notifications, emails stay English)
- Translation management platform (Crowdin, Lokalise, etc.)
- New i18n-specific test files (translations are content, not logic)

---

## Dependencies

| Package                                     | Purpose                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `i18next`                                   | Core translation engine                                                       |
| `react-i18next`                             | React bindings (`useTranslation` hook)                                        |
| `expo-localization`                         | Device locale detection (**must be installed**: `pnpm add expo-localization`) |
| `@react-native-async-storage/async-storage` | Persist language preference (already installed v2.2.0)                        |

**Installation:** `pnpm add i18next react-i18next expo-localization`

**TypeScript config:** Ensure `resolveJsonModule: true` is set in `tsconfig.json` (or inherited from `expo/tsconfig.base`) to allow `import en from '@/locales/en.json'`.

---

## New Files

### `lib/i18n.ts`

i18next initialization and configuration.

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';

const LANGUAGE_KEY = 'user-language';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

async function getStoredLanguage(): Promise<string | null> {
  return AsyncStorage.getItem(LANGUAGE_KEY);
}

function getDeviceLanguage(): string {
  const locales = Localization.getLocales();
  const deviceLang = locales[0]?.languageCode ?? 'en';
  const supported = SUPPORTED_LANGUAGES.map((l) => l.code);
  return supported.includes(deviceLang as LanguageCode) ? deviceLang : 'en';
}

export async function setLanguage(code: LanguageCode): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
  // Note: Does NOT call i18n.changeLanguage() — by design, the new
  // language takes effect only after app restart. This avoids partial
  // re-render issues with cached strings in navigation headers and
  // non-reactive contexts.
}

export async function initI18n(): Promise<void> {
  const stored = await getStoredLanguage();
  const lng = stored ?? getDeviceLanguage();

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

export default i18n;
```

### `locales/en.json`

Flat dot-prefixed keys for all user-facing strings (~150-200 keys). Organized by screen/feature:

```
auth.*          — Sign in, sign up, validation messages
groups.*        — Home tab, group list, filters, balances
friends.*       — Friends tab, contacts, invites
account.*       — Account/settings tab
expense.*       — Add expense modal, categories
group.*         — Group detail, balances, spending
settle.*        — Settle up modal
invite.*        — Invite friend modal
common.*        — Shared labels (Cancel, Save, OK, etc.)
```

### `locales/hi.json`

Same keys as `en.json` with AI-generated Hindi translations. User reviews and corrects before shipping.

---

## Changes to Existing Files

### `app/_layout.tsx`

Initialize i18n before the app renders. Detailed integration:

1. Add a `const [i18nReady, setI18nReady] = useState(false)` state in `RootLayout`
2. In a `useEffect`, call `initI18n().then(() => setI18nReady(true))`
3. Gate rendering: if `!i18nReady`, return the existing splash/loading screen (same as the auth `loading` gate)
4. i18n initializes independently of `AuthProvider` — no provider wrapping needed since `react-i18next` uses the singleton `i18n` instance
5. Order: i18n init completes → providers mount → `RootNavigator` renders

```tsx
// In RootLayout component:
const [i18nReady, setI18nReady] = useState(false);

useEffect(() => {
  initI18n().then(() => setI18nReady(true));
}, []);

if (!i18nReady) {
  return <SplashScreen />; // or null — match existing loading pattern
}

return (
  <AuthProvider>
    <CurrencyProvider>{/* ... existing layout */}</CurrencyProvider>
  </AuthProvider>
);
```

### All Screen Files (19 files)

Replace hardcoded strings with `t()` calls from `useTranslation()`:

```tsx
// Before
<Text>Welcome back</Text>;

// After
const { t } = useTranslation();
<Text>{t('auth.welcomeBack')}</Text>;
```

**Files to modify:**

- `app/auth/sign-in.tsx`
- `app/auth/sign-up.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/friends.tsx`
- `app/(tabs)/account.tsx`
- `app/(tabs)/activity.tsx`
- `app/group/[id].tsx`
- `app/group/balances.tsx`
- `app/group/spending.tsx`
- `app/add-expense.tsx`
- `app/create-group.tsx`
- `app/invite-friend.tsx`
- `app/settle-up.tsx`
- `app/invite.tsx`
- `app/auth/callback.tsx` (if it has user-facing loading/error text)
- Components: `MemberSearchPicker.tsx`, `SplashScreen.tsx` (if applicable)

### `app/(tabs)/account.tsx`

Add a "Language" setting row:

- Displays current language name (e.g., "English" or "हिन्दी")
- Tapping opens a picker/modal with `SUPPORTED_LANGUAGES`
- On selection: saves via `setLanguage()`, shows Alert prompting restart
- Alert text: "Please restart the app to apply the new language."

### Test Mocks

Mock `react-i18next` in test setup to provide a passthrough `t` function:

```ts
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: jest.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: jest.fn() },
}));
```

Place this mock in the **global Jest setup file** (referenced by `setupFilesAfterSetup` in `jest.config.js`) alongside existing mocks for `expo-secure-store` and `expo-router`. This avoids repeating the mock in every test file.

Existing tests continue to work — assertions may need updating from English strings to translation keys.

---

## Translation Key Conventions

| Convention                             | Example                                              |
| -------------------------------------- | ---------------------------------------------------- |
| Flat dot-prefix by screen              | `auth.signIn`, `groups.title`                        |
| camelCase after prefix                 | `auth.fillAllFields`                                 |
| Interpolation with `{{var}}`           | `auth.signInTo: "Sign in to {{appName}}"`            |
| Plurals with `_one`/`_other` suffix    | `groups.memberCount_one`, `groups.memberCount_other` |
| Common/shared strings under `common.*` | `common.cancel`, `common.save`                       |

---

## What Stays in English (Not Translated)

- User-generated content (group names, expense descriptions, usernames)
- Currency symbols and formatted amounts (handled by `useCurrency()`)
- App brand name "PaySplit"
- Category emoji prefixes (🍽, 🚗, etc.)

---

## Language Detection Priority

1. **AsyncStorage** — user's saved preference (from language picker)
2. **Device locale** — via `expo-localization.getLocales()[0].languageCode`
3. **Fallback** — `'en'` (English)

---

## Language Switch Flow

1. User opens Account tab → taps "Language" row
2. Picker shows supported languages with native labels
3. User selects a language
4. Preference saved to AsyncStorage via `setLanguage()`
5. Alert shown: "Please restart the app to apply the new language."
6. On next app launch, `initI18n()` reads saved preference and initializes accordingly

---

## Extensibility

Adding a new language (e.g., Tamil):

1. Create `locales/ta.json` with all translation keys
2. Add entry to `SUPPORTED_LANGUAGES` in `lib/i18n.ts`:
   ```ts
   { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' }
   ```
3. Import and add to `resources` in `initI18n()`

No other code changes required.

---

## Risks & Mitigations

| Risk                                              | Mitigation                                            |
| ------------------------------------------------- | ----------------------------------------------------- |
| AI-generated Hindi translations may be inaccurate | User reviews all translations before shipping         |
| Missing translation keys show raw keys in UI      | i18next `fallbackLng: 'en'` ensures English fallback  |
| Existing tests break due to string changes        | Mock `react-i18next` with passthrough `t` function    |
| Large diff touching many files                    | Break into incremental PRs (infra → screen-by-screen) |
| `resolveJsonModule` not enabled                   | Verify tsconfig before implementation; add if missing |

---

## Notes

- **Hindi pluralization:** Hindi uses `one` and `other` plural categories (same as English). i18next handles this natively — no custom plural rules needed. Hindi JSON files use the same `_one`/`_other` suffixes.
- **Accessibility strings:** `accessibilityLabel` and `accessibilityHint` props containing user-facing text should also use `t()` keys. Include these when extracting strings from each screen.
- **Restart-required rationale:** Live language switching was considered but rejected to avoid partial re-render issues — navigation headers, cached strings in non-reactive contexts (e.g., `Alert.alert()` calls), and tab bar labels may not update consistently without a full restart. This keeps the implementation simpler and more reliable.
- **Missing key detection (dev-time):** Consider enabling `i18next`'s `saveMissing` option during development to log untranslated keys to the console. A CI script to diff keys between `en.json` and `hi.json` can be added as a follow-up.
