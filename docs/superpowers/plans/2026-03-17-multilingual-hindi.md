# Multi-lingual Support (Hindi) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add i18n infrastructure to PaySplit with Hindi as the first additional language, using i18next + react-i18next.

**Architecture:** i18next singleton initialized before app render, language detected from AsyncStorage > device locale > English fallback. All hardcoded strings extracted to flat-key JSON files. Language picker in Account tab with restart-required behavior.

**Tech Stack:** i18next, react-i18next, expo-localization, @react-native-async-storage/async-storage (already installed)

**Spec:** `docs/superpowers/specs/2026-03-16-multilingual-hindi-design.md`

---

## File Structure

### New Files

| File              | Responsibility                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `lib/i18n.ts`     | i18next init, language detection, `SUPPORTED_LANGUAGES` config, `setLanguage()`, `initI18n()` |
| `locales/en.json` | All English translation strings (~200 flat dot-prefixed keys)                                 |
| `locales/hi.json` | Hindi translations (AI-generated first pass for review)                                       |

### Modified Files

| File                                | Change                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `app/_layout.tsx`                   | Add `i18nReady` state gate, call `initI18n()` before render                                  |
| `app/auth/sign-in.tsx`              | Replace hardcoded strings with `t()` calls                                                   |
| `app/auth/sign-up.tsx`              | Replace hardcoded strings with `t()` calls                                                   |
| `app/auth/callback.tsx`             | Replace "Signing you in..." with `t()`                                                       |
| `app/(tabs)/index.tsx`              | Replace hardcoded strings with `t()` calls                                                   |
| `app/(tabs)/friends.tsx`            | Replace hardcoded strings with `t()` calls                                                   |
| `app/(tabs)/activity.tsx`           | Replace hardcoded strings with `t()` calls                                                   |
| `app/(tabs)/account.tsx`            | Replace hardcoded strings with `t()` calls + add Language picker row + Language picker modal |
| `app/group/[id].tsx`                | Replace hardcoded strings with `t()` calls                                                   |
| `app/group/balances.tsx`            | Replace hardcoded strings with `t()` calls                                                   |
| `app/group/spending.tsx`            | Replace hardcoded strings with `t()` calls                                                   |
| `app/add-expense.tsx`               | Replace hardcoded strings with `t()` calls                                                   |
| `app/create-group.tsx`              | Replace hardcoded strings with `t()` calls                                                   |
| `app/settle-up.tsx`                 | Replace hardcoded strings with `t()` calls                                                   |
| `app/invite-friend.tsx`             | Replace hardcoded strings with `t()` calls                                                   |
| `components/MemberSearchPicker.tsx` | Replace hardcoded strings with `t()` calls                                                   |
| `components/SplashScreen.tsx`       | Replace "Loading..." and "Settling expenses made simple" with `t()` calls                    |
| `app/(tabs)/_layout.tsx`            | Replace hardcoded tab bar titles with `t()` calls                                            |
| `app/invite.tsx`                    | No changes needed (pure redirect, no user-facing strings)                                    |
| `jest.config.js`                    | Add `react-i18next`, `i18next`, and `expo-localization` mock mappings                        |
| `__mocks__/react-i18next.ts`        | New mock file for test passthrough                                                           |
| `__mocks__/i18next.ts`              | New mock file for i18next default export                                                     |
| `__mocks__/expo-localization.ts`    | New mock file for tests                                                                      |

---

## Chunk 1: Infrastructure (lib/i18n.ts, locales, mocks, \_layout.tsx)

### Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install i18next, react-i18next, expo-localization**

```bash
pnpm add i18next react-i18next expo-localization
```

- [ ] **Step 2: Verify installation**

```bash
pnpm list i18next react-i18next expo-localization
```

Expected: All three packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(i18n): install i18next, react-i18next, expo-localization"
```

---

### Task 2: Create English translation file

**Files:**

- Create: `locales/en.json`

- [ ] **Step 1: Create `locales/en.json`**

```json
{
  "auth.welcomeBack": "Welcome back",
  "auth.signInTo": "Sign in to {{appName}}",
  "auth.signIn": "Sign In",
  "auth.signUp": "Sign Up",
  "auth.createAccount": "Create account",
  "auth.joinApp": "Join {{appName}} to split expenses",
  "auth.email": "Email",
  "auth.emailOrPhone": "Email or phone number",
  "auth.phone": "Phone number (e.g. +1 555 000 1234)",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm Password",
  "auth.fillAllFields": "Please fill in all fields.",
  "auth.invalidPhone": "Enter a valid phone number with country code (e.g. +1 555 000 1234).",
  "auth.passwordMismatch": "Passwords do not match.",
  "auth.passwordTooShort": "Password must be at least 6 characters.",
  "auth.continueWithGoogle": "Continue with Google",
  "auth.or": "or",
  "auth.noAccount": "Don't have an account? ",
  "auth.hasAccount": "Already have an account? ",
  "auth.checkEmail": "Check your email",
  "auth.confirmationSent": "We sent a confirmation link to {{email}}. Click it to activate your account.",
  "auth.backToSignIn": "Back to Sign In",
  "auth.signingIn": "Signing you in\u2026",
  "auth.createAccountBtn": "Create Account",

  "groups.title": "Your Groups",
  "groups.searchPlaceholder": "Search groups\u2026",
  "groups.noMatch": "No groups match your search",
  "groups.startNew": "Start a new group",
  "groups.totalBalance": "Total Balance",
  "groups.youAreOwed": "You are owed {{amount}}",
  "groups.youOwe": "You owe {{amount}}",
  "groups.allSettled": "You are all settled up",
  "groups.acrossActive": "across active groups",
  "groups.acrossAll": "across all groups",
  "groups.settledUp": "settled up",
  "groups.youAreOwedShort": "you are owed",
  "groups.youOweShort": "you owe",
  "groups.retry": "Retry",
  "groups.filterAll": "All",
  "groups.filterOwed": "Owed to me",
  "groups.filterOwe": "I owe",
  "groups.filterSettled": "Settled",

  "friends.title": "Friends",
  "friends.searchPlaceholder": "Search contacts\u2026",
  "friends.onApp": "On PaySplit",
  "friends.inviteToApp": "Invite to PaySplit",
  "friends.invite": "Invite",
  "friends.addToGroup": "Add to Group",
  "friends.viewBalance": "View Balance",
  "friends.contactsRequired": "Contacts Access Required",
  "friends.contactsBody": "PaySplit needs access to your contacts to show which friends are already on the app.",
  "friends.allowAccess": "Allow Access",
  "friends.noMatchesFound": "No matches found.",
  "friends.noneOnApp": "None of your contacts are on PaySplit yet.",
  "friends.allOnApp": "All your contacts are already on PaySplit.",
  "friends.showMore": "Show {{count}} more",
  "friends.youAreOwed": "You are owed {{amount}}",
  "friends.youOwe": "You owe {{amount}}",
  "friends.settledUp": "Settled up",
  "friends.noSharedGroups": "No shared groups",
  "friends.inviteMessage": "Hey! I use {{appName}} to split bills with friends. Download it here: {{link}}",

  "activity.title": "Activity",
  "activity.filterAll": "All",
  "activity.filterExpenses": "Expenses",
  "activity.filterSettlements": "Settlements",
  "activity.filterMine": "My activity",
  "activity.noActivityTitle": "No activity yet",
  "activity.noActivitySub": "Add expenses to see your history here",
  "activity.youLent": "you lent",
  "activity.youOwe": "you owe",
  "activity.you": "You",
  "activity.paid": "{{name}} paid {{amount}}",
  "activity.youPaid": "You paid {{name}}",
  "activity.someonePaidYou": "{{name}} paid you",
  "activity.settled": "settled",
  "activity.today": "Today",
  "activity.yesterday": "Yesterday",
  "activity.daysAgo": "{{count}} days ago",
  "activity.thisMonth": "This month",
  "activity.lastMonth": "Last month",

  "account.profile": "PROFILE",
  "account.preferences": "PREFERENCES",
  "account.accountSection": "ACCOUNT",
  "account.phoneNumber": "Phone Number",
  "account.addPhoneNumber": "Add phone number",
  "account.phoneHint": "Used to match you with contacts. Include country code (e.g. +1 555 000 1234).",
  "account.invalidPhone": "Enter a valid phone number (e.g. +1 555 000 1234)",
  "account.currency": "Currency",
  "account.selectCurrency": "Select Currency",
  "account.language": "Language",
  "account.selectLanguage": "Select Language",
  "account.restartRequired": "Please restart the app to apply the new language.",
  "account.restartTitle": "Restart Required",
  "account.signOut": "Sign Out",

  "expense.addExpense": "Add expense",
  "expense.selectGroup": "Select a group (required)",
  "expense.description": "Description (e.g. Dinner)",
  "expense.paidBy": "Paid by",
  "expense.split": "Split",
  "expense.change": "Change",
  "expense.customize": "Customize",
  "expense.done": "Done",
  "expense.equally": "Equally",
  "expense.exact": "Exact",
  "expense.percent": "Percent",
  "expense.equalSplitSummary": "Equally \u00b7 {{count}} member{{plural}}",
  "expense.exactAmounts": "Exact amounts",
  "expense.byPercent": "By percent",
  "expense.splitComingSoon": "Only equal splits are supported right now. Exact and percent splits coming soon.",
  "expense.category": "Category",
  "expense.autoDetected": "Auto-detected",
  "expense.customCategoryPlaceholder": "e.g. Health & Wellness",
  "expense.categorySaveHint": "Will be saved on expense creation",
  "expense.addReceipt": "Add receipt photo",
  "expense.uploading": "Uploading\u2026",
  "expense.saveExpense": "Save Expense",
  "expense.selectGroupSheet": "Select Group",
  "expense.whoPaid": "Who paid?",
  "expense.expenseCurrency": "Expense Currency",
  "expense.validAmount": "Enter a valid amount greater than zero.",
  "expense.selectGroupError": "Please select a group.",
  "expense.selectPayer": "Please select who paid.",
  "expense.selectMembers": "Select at least one member to split with.",
  "expense.addDescription": "Please add a description.",
  "expense.cameraPermission": "Camera roll permission is required to add a receipt photo.",
  "expense.uploadFailed": "Failed to upload receipt photo.",
  "expense.categoryFood": "\ud83c\udf7d Food & Drink",
  "expense.categoryTransport": "\ud83d\ude97 Transport",
  "expense.categoryAccommodation": "\ud83c\udfe8 Accommodation",
  "expense.categoryEntertainment": "\ud83c\udfac Entertainment",
  "expense.categoryShopping": "\ud83d\udecd Shopping",
  "expense.categoryOther": "\u2699\ufe0f Other",
  "expense.you": "You",
  "expense.unknown": "Unknown",

  "group.totalBalance": "Total Balance",
  "group.allSettled": "All settled up",
  "group.youAreOwed": "You are owed {{amount}}",
  "group.youOwe": "You owe {{amount}}",
  "group.settleUp": "Settle up",
  "group.balances": "Balances",
  "group.addMember": "Add member",
  "group.expenses": "Expenses",
  "group.spending": "Spending \u2192",
  "group.noExpenses": "No expenses yet",
  "group.addExpense": "Add an expense",
  "group.youLent": "you lent",
  "group.youOweShort": "you owe",
  "group.paidAmount": "{{name}} paid {{amount}}",
  "group.notFound": "Group not found",
  "group.settings": "Group Settings",
  "group.archiveGroup": "Archive Group",
  "group.deleteGroup": "Delete Group",
  "group.leaveGroup": "Leave Group",
  "group.deleteTitle": "Delete Group",
  "group.leaveTitle": "Leave Group",
  "group.deleteWarning": "This will permanently delete {{name}} and all its expenses. This cannot be undone.",
  "group.leaveWarning": "You will be removed from {{name}}. You can rejoin via an invite link.",
  "group.typeToConfirm": "Type {{name}} to confirm",
  "group.deleting": "Deleting\u2026",
  "group.leaving": "Leaving\u2026",

  "balances.groupMembers": "GROUP MEMBERS",
  "balances.allSettled": "All settled up",
  "balances.youAreOwedTotal": "You are owed in total",
  "balances.youOweTotal": "You owe in total",
  "balances.allSettledTotal": "You are all settled up",
  "balances.settledUp": "Settled up",
  "balances.owesYou": "owes you {{amount}}",
  "balances.youOwe": "you owe {{amount}}",
  "balances.settleUpBtn": "Settle up",
  "balances.pay": "Pay",
  "balances.viewChart": "View chart",
  "balances.me": "ME",
  "balances.you": "You",

  "settle.title": "Settle Up",
  "settle.youPaid": "You paid {{name}}",
  "settle.theyPaid": "{{name}} paid you",
  "settle.overpayment": "This exceeds the outstanding balance",
  "settle.paymentMethod": "PAYMENT METHOD",
  "settle.cashLabel": "Record a cash payment",
  "settle.cashSub": "No transfer needed",
  "settle.venmoLabel": "Pay via Venmo/PayPal",
  "settle.venmoSub": "Open external app",
  "settle.date": "DATE",
  "settle.noteOptional": "NOTE (OPTIONAL)",
  "settle.notePlaceholder": "Add a note\u2026",
  "settle.addReceipt": "Add a receipt image",
  "settle.saving": "Saving\u2026",
  "settle.savePayment": "Save Payment",
  "settle.noPayee": "No payee selected. Go back and tap Settle up on a specific member.",

  "createGroup.title": "New Group",
  "createGroup.create": "Create",
  "createGroup.iconHintEmpty": "Icon and colour chosen from group name",
  "createGroup.iconHintSelected": "Auto-selected \u00b7 tap below to override",
  "createGroup.groupName": "GROUP NAME *",
  "createGroup.groupNamePlaceholder": "e.g. Japan Trip, Apartment 4B\u2026",
  "createGroup.descriptionLabel": "DESCRIPTION",
  "createGroup.descriptionPlaceholder": "What's this group for? (optional)",
  "createGroup.addMembers": "ADD MEMBERS (OPTIONAL)",
  "createGroup.createGroup": "Create Group",
  "createGroup.failedCreate": "Failed to create group. Please try again.",
  "createGroup.failedAddMember": "Group created but failed to add you as member.",
  "createGroup.somethingWrong": "Something went wrong. Please try again.",

  "invite.title": "Add members",
  "invite.add": "Add",
  "invite.membersAdded": "Members added",
  "invite.done": "Done",
  "invite.addCount": "Add {{count}} member{{plural}}",
  "invite.selectMembers": "Select members above",
  "invite.shareInviteLink": "Share invite link{{plural}}",

  "spending.title": "Spending",
  "spending.noDataTitle": "No spending data yet",
  "spending.noDataSub": "Add expenses to see spending by category",
  "spending.totalGroupSpend": "TOTAL GROUP SPEND",
  "spending.expenseCount": "{{count}} expenses across {{categories}} {{categoryLabel}}",
  "spending.category": "category",
  "spending.categories": "categories",
  "spending.expenseSingular": "expense",
  "spending.expensePlural": "expenses",
  "spending.breakdown": "BREAKDOWN",
  "spending.shareSummary": "Share Summary",
  "spending.expenseSummary": "Expense Summary",
  "spending.totalSpent": "TOTAL SPENT",
  "spending.share": "Share",
  "spending.sharedVia": "Shared via PaySplit",

  "memberPicker.searchPlaceholder": "Search by name, phone, or email\u2026",
  "memberPicker.loadingContacts": "Loading contacts\u2026",
  "memberPicker.grantPermission": "Grant contacts permission to search your address book.",
  "memberPicker.onApp": "On PaySplit",
  "memberPicker.inviteSection": "Invite",
  "memberPicker.add": "Add",
  "memberPicker.invite": "Invite",
  "memberPicker.contact": "Contact",
  "memberPicker.noMatches": "No contacts matching \"{{query}}\"",

  "tabs.groups": "Groups",
  "tabs.friends": "Friends",
  "tabs.activity": "Activity",
  "tabs.account": "Account",

  "splash.loading": "Loading\u2026",
  "splash.tagline": "Settling expenses made simple",

  "activity.someone": "someone",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.ok": "OK",
  "common.retry": "Retry"
}
```

- [ ] **Step 2: Commit**

```bash
git add locales/en.json
git commit -m "feat(i18n): add English translation file with all UI strings"
```

---

### Task 3: Create Hindi translation file

**Files:**

- Create: `locales/hi.json`

- [ ] **Step 1: Create `locales/hi.json`**

Generate AI-translated Hindi values for all keys in `en.json`. Use the same key structure. The user will review and correct these before shipping.

Important notes for Hindi translations:

- Keep brand name "PaySplit" untranslated
- Keep interpolation variables `{{var}}` intact
- Keep emoji prefixes (🍽, 🚗, etc.) intact
- Hindi is LTR — no special layout handling needed

- [ ] **Step 2: Commit**

```bash
git add locales/hi.json
git commit -m "feat(i18n): add Hindi translation file (AI-generated, pending review)"
```

---

### Task 4: Create i18n initialization module

**Files:**

- Create: `lib/i18n.ts`

- [ ] **Step 1: Create `lib/i18n.ts`**

```typescript
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

- [ ] **Step 2: Verify tsconfig allows JSON imports**

Check that `resolveJsonModule: true` is inherited from `expo/tsconfig.base`. If not, add it to `tsconfig.json` compilerOptions.

Run: `pnpm typecheck` — should pass (no screens use `t()` yet, so no errors expected).

- [ ] **Step 3: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): add i18n initialization module with language detection"
```

---

### Task 5: Create test mocks

**Files:**

- Create: `__mocks__/react-i18next.ts`
- Create: `__mocks__/expo-localization.ts`
- Modify: `jest.config.js`

- [ ] **Step 1: Create `__mocks__/react-i18next.ts`**

```typescript
export const useTranslation = () => ({
  t: (key: string) => key,
  i18n: { language: 'en', changeLanguage: jest.fn() },
});

export const initReactI18next = { type: '3rdParty', init: jest.fn() };
```

- [ ] **Step 2: Create `__mocks__/expo-localization.ts`**

```typescript
export function getLocales() {
  return [{ languageCode: 'en', languageTag: 'en-US' }];
}

export function getCalendars() {
  return [
    {
      calendar: 'gregory',
      timeZone: 'America/New_York',
      uses24hourClock: false,
    },
  ];
}
```

- [ ] **Step 3: Create `__mocks__/i18next.ts`**

```typescript
const i18next = {
  use: jest.fn().mockReturnThis(),
  init: jest.fn().mockResolvedValue(undefined),
  t: (key: string) => key,
  language: 'en',
  changeLanguage: jest.fn(),
};

export default i18next;
```

- [ ] **Step 4: Add mock mappings to `jest.config.js`**

Add these entries to the `moduleNameMapper` object in `jest.config.js`:

```javascript
'^react-i18next$': '<rootDir>/__mocks__/react-i18next.ts',
'^i18next$': '<rootDir>/__mocks__/i18next.ts',
'^expo-localization$': '<rootDir>/__mocks__/expo-localization.ts',
```

- [ ] **Step 5: Run existing tests to verify mocks don't break anything**

```bash
pnpm test
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add __mocks__/react-i18next.ts __mocks__/i18next.ts __mocks__/expo-localization.ts jest.config.js
git commit -m "feat(i18n): add test mocks for react-i18next and expo-localization"
```

---

### Task 6: Integrate i18n init into root layout

**Files:**

- Modify: `app/_layout.tsx:1-81`

- [ ] **Step 1: Add i18n imports and state to `app/_layout.tsx`**

Add to imports at line 4:

```typescript
import { useState, useEffect, useRef } from 'react';
import { initI18n } from '@/lib/i18n';
```

(Note: `useState` and `useEffect` are already imported via `useEffect` and `useRef` — just add `useState` to the existing import and add the `initI18n` import.)

- [ ] **Step 2: Add i18nReady gate to `RootLayout` function**

Modify the `RootLayout` function (line 73-81) to:

```typescript
export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) {
    return <SplashScreen />;
  }

  return (
    <CurrencyProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </CurrencyProvider>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(i18n): integrate i18n initialization into root layout"
```

---

## Chunk 2: Auth Screens (sign-in, sign-up, callback)

### Task 7: Translate sign-in screen

**Files:**

- Modify: `app/auth/sign-in.tsx`

- [ ] **Step 1: Add `useTranslation` import**

```typescript
import { useTranslation } from 'react-i18next';
```

- [ ] **Step 2: Add hook call inside `SignInScreen`**

After `const [googleLoading, setGoogleLoading] = useState(false);` (line 38), add:

```typescript
const { t } = useTranslation();
```

- [ ] **Step 3: Replace all hardcoded strings**

| Line | Before                                | After                                                 |
| ---- | ------------------------------------- | ----------------------------------------------------- |
| 42   | `'Please fill in all fields.'`        | `t('auth.fillAllFields')`                             |
| 74   | `Welcome back`                        | `{t('auth.welcomeBack')}`                             |
| 75   | `Sign in to {APP_DISPLAY_NAME}`       | `{t('auth.signInTo', { appName: APP_DISPLAY_NAME })}` |
| 90   | `Continue with Google`                | `{t('auth.continueWithGoogle')}`                      |
| 98   | `or`                                  | `{t('auth.or')}`                                      |
| 104  | `"Email or phone number"` placeholder | `t('auth.emailOrPhone')`                              |
| 115  | `"Password"` placeholder              | `t('auth.password')`                                  |
| 131  | `Sign In`                             | `{t('auth.signIn')}`                                  |
| 136  | `Don't have an account? `             | `{t('auth.noAccount')}`                               |
| 137  | `Sign Up`                             | `{t('auth.signUp')}`                                  |

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add app/auth/sign-in.tsx
git commit -m "feat(i18n): translate sign-in screen"
```

---

### Task 8: Translate sign-up screen

**Files:**

- Modify: `app/auth/sign-up.tsx`

- [ ] **Step 1: Add `useTranslation` import and hook**

Same pattern as sign-in.

- [ ] **Step 2: Replace all hardcoded strings**

| Location | Before                                      | After                                                |
| -------- | ------------------------------------------- | ---------------------------------------------------- |
| Line 44  | `'Please fill in all fields.'`              | `t('auth.fillAllFields')`                            |
| Line 49  | `'Enter a valid phone number...'`           | `t('auth.invalidPhone')`                             |
| Line 53  | `'Passwords do not match.'`                 | `t('auth.passwordMismatch')`                         |
| Line 57  | `'Password must be at least 6 characters.'` | `t('auth.passwordTooShort')`                         |
| Line 86  | `Check your email`                          | `{t('auth.checkEmail')}`                             |
| Line 88  | `We sent a confirmation link to...`         | `{t('auth.confirmationSent', { email })}`            |
| Line 94  | `Back to Sign In`                           | `{t('auth.backToSignIn')}`                           |
| Line 110 | `Create account`                            | `{t('auth.createAccount')}`                          |
| Line 111 | `Join {APP_DISPLAY_NAME} to split expenses` | `{t('auth.joinApp', { appName: APP_DISPLAY_NAME })}` |
| Line 126 | `Continue with Google`                      | `{t('auth.continueWithGoogle')}`                     |
| Line 134 | `or`                                        | `{t('auth.or')}`                                     |
| Line 140 | `"Email"` placeholder                       | `t('auth.email')`                                    |
| Line 151 | `"Phone number..."` placeholder             | `t('auth.phone')`                                    |
| Line 159 | `"Password"` placeholder                    | `t('auth.password')`                                 |
| Line 170 | `"Confirm Password"` placeholder            | `t('auth.confirmPassword')`                          |
| Line 185 | `Create Account`                            | `{t('auth.createAccountBtn')}`                       |
| Line 190 | `Already have an account? `                 | `{t('auth.hasAccount')}`                             |
| Line 191 | `Sign In`                                   | `{t('auth.signIn')}`                                 |

- [ ] **Step 3: Commit**

```bash
git add app/auth/sign-up.tsx
git commit -m "feat(i18n): translate sign-up screen"
```

---

### Task 9: Translate auth callback screen

**Files:**

- Modify: `app/auth/callback.tsx`

- [ ] **Step 1: Add `useTranslation` and replace string**

Replace `Signing you in…` (line 34) with `{t('auth.signingIn')}`.

- [ ] **Step 2: Commit**

```bash
git add app/auth/callback.tsx
git commit -m "feat(i18n): translate auth callback screen"
```

---

## Chunk 3: Tab Screens (groups, friends, activity, account)

### Task 10: Translate groups home screen

**Files:**

- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Add `useTranslation` import and hook**

- [ ] **Step 2: Replace strings in `GroupCard` component**

Pass `t` as a prop or use hook inside `GroupCard`. Key replacements:

| Before           | After                         |
| ---------------- | ----------------------------- |
| `'settled up'`   | `t('groups.settledUp')`       |
| `'you are owed'` | `t('groups.youAreOwedShort')` |
| `'you owe'`      | `t('groups.youOweShort')`     |

- [ ] **Step 3: Replace strings in `TotalBalanceDisplay`**

| Before                                           | After                                                |
| ------------------------------------------------ | ---------------------------------------------------- |
| `'You are all settled up'`                       | `t('groups.allSettled')`                             |
| `` `You are owed ${format(cents)}` ``            | `t('groups.youAreOwed', { amount: format(cents) })`  |
| `` `You owe ${format(cents)}` ``                 | `t('groups.youOwe', { amount: format(cents) })`      |
| `'Total Balance'`                                | `t('groups.totalBalance')`                           |
| `'across active groups'` / `'across all groups'` | `t('groups.acrossActive')` / `t('groups.acrossAll')` |

- [ ] **Step 4: Replace strings in `STATUS_FILTERS`**

Make `STATUS_FILTERS` use `t()` by computing them inside the component:

```typescript
const statusFilters = useMemo(
  () => [
    { key: 'all' as const, label: t('groups.filterAll') },
    { key: 'owed' as const, label: t('groups.filterOwed') },
    { key: 'owes' as const, label: t('groups.filterOwe') },
    { key: 'settled' as const, label: t('groups.filterSettled') },
  ],
  [t],
);
```

- [ ] **Step 5: Replace remaining strings**

| Before                          | After                           |
| ------------------------------- | ------------------------------- |
| `'Your Groups'`                 | `t('groups.title')`             |
| `'Search groups…'` placeholder  | `t('groups.searchPlaceholder')` |
| `'No groups match your search'` | `t('groups.noMatch')`           |
| `'Start a new group'`           | `t('groups.startNew')`          |
| `'Retry'`                       | `t('common.retry')`             |

- [ ] **Step 6: Run typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat(i18n): translate groups home screen"
```

---

### Task 11: Translate friends screen

**Files:**

- Modify: `app/(tabs)/friends.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- `'Friends'` → `t('friends.title')`
- `'Search contacts…'` → `t('friends.searchPlaceholder')`
- `'On PaySplit'` → `t('friends.onApp')`
- `'Invite to PaySplit'` → `t('friends.inviteToApp')`
- `'Invite'` → `t('friends.invite')`
- `'Add to Group'` → `t('friends.addToGroup')`
- `'View Balance'` → `t('friends.viewBalance')`
- `'Cancel'` → `t('common.cancel')`
- `'Contacts Access Required'` → `t('friends.contactsRequired')`
- `'PaySplit needs access...'` → `t('friends.contactsBody')`
- `'Allow Access'` → `t('friends.allowAccess')`
- `'Retry'` → `t('common.retry')`
- `'No matches found.'` → `t('friends.noMatchesFound')`
- `'None of your contacts are on PaySplit yet.'` → `t('friends.noneOnApp')`
- `'All your contacts are already on PaySplit.'` → `t('friends.allOnApp')`
- Balance chip texts use interpolated keys
- Share message uses `t('friends.inviteMessage', { appName, link })`

- [ ] **Step 2: Commit**

```bash
git add app/(tabs)/friends.tsx
git commit -m "feat(i18n): translate friends screen"
```

---

### Task 12: Translate activity screen

**Files:**

- Modify: `app/(tabs)/activity.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- `'Activity'` → `t('activity.title')`
- Filter labels → use computed array with `t()` like groups screen
- `'No activity yet'` → `t('activity.noActivityTitle')`
- `'Add expenses to see your history here'` → `t('activity.noActivitySub')`
- `'you lent'` → `t('activity.youLent')`
- `'you owe'` → `t('activity.youOwe')`
- `'You'` → `t('activity.you')`
- `'settled'` → `t('activity.settled')`
- `'Today'`, `'Yesterday'` → `t('activity.today')`, `t('activity.yesterday')`
- `'This month'`, `'Last month'` → `t('activity.thisMonth')`, `t('activity.lastMonth')`

Note: The `relativeTime` and `monthKey` functions use hardcoded English. These should be updated to accept `t` or use the translation keys.

- [ ] **Step 2: Commit**

```bash
git add app/(tabs)/activity.tsx
git commit -m "feat(i18n): translate activity screen"
```

---

### Task 13: Translate account screen + add language picker

**Files:**

- Modify: `app/(tabs)/account.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import {
  SUPPORTED_LANGUAGES,
  setLanguage,
  type LanguageCode,
} from '@/lib/i18n';
import i18n from '@/lib/i18n';
```

- [ ] **Step 2: Add `useTranslation` hook and language state**

Inside `AccountScreen`, add:

```typescript
const { t } = useTranslation();
const [langPickerVisible, setLangPickerVisible] = useState(false);

const currentLang =
  SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ??
  SUPPORTED_LANGUAGES[0];
```

- [ ] **Step 3: Add language selection handler**

```typescript
const handleSelectLanguage = async (code: LanguageCode) => {
  await setLanguage(code);
  setLangPickerVisible(false);
  Alert.alert(t('account.restartTitle'), t('account.restartRequired'));
};
```

- [ ] **Step 4: Replace existing hardcoded strings with `t()` calls**

| Before                            | After                         |
| --------------------------------- | ----------------------------- |
| `"PROFILE"`                       | `t('account.profile')`        |
| `"Phone Number"`                  | `t('account.phoneNumber')`    |
| `'Add phone number'`              | `t('account.addPhoneNumber')` |
| `"PREFERENCES"`                   | `t('account.preferences')`    |
| `"Currency"`                      | `t('account.currency')`       |
| `"Select Currency"`               | `t('account.selectCurrency')` |
| `"ACCOUNT"`                       | `t('account.accountSection')` |
| `"Sign Out"`                      | `t('account.signOut')`        |
| `"Phone Number"` sheet title      | `t('account.phoneNumber')`    |
| `"Used to match you..."`          | `t('account.phoneHint')`      |
| `'Enter a valid phone number...'` | `t('account.invalidPhone')`   |
| `"Save"` button                   | `t('common.save')`            |

- [ ] **Step 5: Add Language setting row in PREFERENCES section**

After the Currency `SettingRow`, add:

```tsx
<SettingRow
  icon="language"
  label={t('account.language')}
  value={currentLang.nativeLabel}
  onPress={() => setLangPickerVisible(true)}
/>
```

- [ ] **Step 6: Add Language picker modal**

After the Currency Picker Modal, add a Language Picker Modal following the same pattern:

```tsx
<Modal
  visible={langPickerVisible}
  transparent
  animationType="slide"
  onRequestClose={() => setLangPickerVisible(false)}
>
  <Pressable style={s.modalOverlay} onPress={() => setLangPickerVisible(false)}>
    <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
      <View style={s.sheetHandle} />
      <Text style={s.sheetTitle}>{t('account.selectLanguage')}</Text>
      <FlatList
        data={
          SUPPORTED_LANGUAGES as unknown as (typeof SUPPORTED_LANGUAGES)[number][]
        }
        keyExtractor={(item) => item.code}
        renderItem={({ item }) => {
          const isSelected = item.code === i18n.language;
          return (
            <TouchableOpacity
              style={[s.currencyRow, isSelected && s.currencyRowSelected]}
              onPress={() => handleSelectLanguage(item.code as LanguageCode)}
              activeOpacity={0.7}
            >
              <View style={s.currencyInfo}>
                <Text
                  style={[s.currencyCode, isSelected && s.currencyCodeSelected]}
                >
                  {item.nativeLabel}
                </Text>
                <Text style={s.currencyName}>{item.label}</Text>
              </View>
              {isSelected && (
                <MaterialIcons name="check" size={20} color={C.primary} />
              )}
            </TouchableOpacity>
          );
        }}
        ItemSeparatorComponent={() => <View style={s.separator} />}
        scrollEnabled={false}
      />
    </View>
  </Pressable>
</Modal>
```

- [ ] **Step 7: Run typecheck + tests**

```bash
pnpm typecheck && pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add app/(tabs)/account.tsx
git commit -m "feat(i18n): translate account screen and add language picker"
```

---

## Chunk 3b: Group Screens

### Task 14: Translate group detail screen

**Files:**

- Modify: `app/group/[id].tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements (~25 strings):

- Balance text, action buttons ("Settle up", "Balances", "Add member")
- Expenses section header, empty state
- Settings modal ("Group Settings", "Archive Group", "Delete Group", "Leave Group")
- Delete confirmation modal (title, warning text, button labels)
- `"you lent"`, `"you owe"`, paid labels

- [ ] **Step 2: Commit**

```bash
git add app/group/[id].tsx
git commit -m "feat(i18n): translate group detail screen"
```

---

### Task 15: Translate group balances screen

**Files:**

- Modify: `app/group/balances.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- `'All settled up'`, `'You are owed in total'`, `'You owe in total'`, `'You are all settled up'`
- `'GROUP MEMBERS'`, `'View chart'`
- `'Settled up'`, `'owes you'`, `'you owe'`
- `'Settle up'`, `'Pay'`
- `'ME'`, `'You'`

- [ ] **Step 2: Commit**

```bash
git add app/group/balances.tsx
git commit -m "feat(i18n): translate group balances screen"
```

---

### Task 16: Translate spending screen

**Files:**

- Modify: `app/group/spending.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- `'Spending'`, empty state text
- `'TOTAL GROUP SPEND'`, expense count text
- `'BREAKDOWN'`, `'Share Summary'`, `'Expense Summary'`
- `'TOTAL SPENT'`, `'Share'`, `'Shared via PaySplit'`

- [ ] **Step 2: Commit**

```bash
git add app/group/spending.tsx
git commit -m "feat(i18n): translate spending screen"
```

---

## Chunk 4: Modal Screens

### Task 17: Translate add-expense screen

**Files:**

- Modify: `app/add-expense.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements (~30 strings):

- Header: "Cancel", "Add expense", "Save"
- `'Select a group (required)'`, `'Description (e.g. Dinner)'`
- Paid by label, "Change"
- Split section: "Equally", "Exact", "Percent", summary text, coming soon text
- Category section: labels, "Auto-detected", custom category hint
- Receipt: "Add receipt photo", "Uploading…"
- Save button: "Save Expense"
- Modal titles: "Select Group", "Who paid?", "Expense Currency"
- Error messages (validation)
- `CATEGORY_LABELS` values → use `t()` keys
- `'You'` label for current user member

- [ ] **Step 2: Commit**

```bash
git add app/add-expense.tsx
git commit -m "feat(i18n): translate add-expense screen"
```

---

### Task 18: Translate create-group screen

**Files:**

- Modify: `app/create-group.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- "Cancel", "New Group", "Create"
- Preview hint texts
- "GROUP NAME \*", placeholder
- "DESCRIPTION", placeholder
- "ADD MEMBERS (OPTIONAL)"
- "Create Group" button
- Error messages

- [ ] **Step 2: Commit**

```bash
git add app/create-group.tsx
git commit -m "feat(i18n): translate create-group screen"
```

---

### Task 19: Translate settle-up screen

**Files:**

- Modify: `app/settle-up.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- "Settle Up" header
- Payment amount labels ("You paid {{name}}" / "{{name}} paid you")
- "This exceeds the outstanding balance"
- "PAYMENT METHOD", method labels and descriptions
- "DATE", "NOTE (OPTIONAL)", placeholders
- "Add a receipt image"
- "Save Payment", "Saving…"
- Missing payee error text

- [ ] **Step 2: Commit**

```bash
git add app/settle-up.tsx
git commit -m "feat(i18n): translate settle-up screen"
```

---

### Task 20: Translate invite-friend screen

**Files:**

- Modify: `app/invite-friend.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- "Cancel", "Add members", "Add"
- "Done", "Members added"
- Success state title and subtitle (dynamic with counts)
- "Share invite link(s)" button
- "Add N member(s)" / "Select members above"

- [ ] **Step 2: Commit**

```bash
git add app/invite-friend.tsx
git commit -m "feat(i18n): translate invite-friend screen"
```

---

### Task 21: Translate MemberSearchPicker component

**Files:**

- Modify: `components/MemberSearchPicker.tsx`

- [ ] **Step 1: Add `useTranslation` and replace all strings**

Key replacements:

- `'Search by name, phone, or email…'` → `t('memberPicker.searchPlaceholder')`
- `'Loading contacts…'` → `t('memberPicker.loadingContacts')`
- `'Grant contacts permission...'` → `t('memberPicker.grantPermission')`
- `'On PaySplit'` → `t('memberPicker.onApp')`
- `'Invite'` (section + badge) → `t('memberPicker.inviteSection')` / `t('memberPicker.invite')`
- `'Add'` → `t('memberPicker.add')`
- `'Contact'` → `t('memberPicker.contact')`
- No matches text → `t('memberPicker.noMatches', { query: debouncedQuery })`

- [ ] **Step 2: Commit**

```bash
git add components/MemberSearchPicker.tsx
git commit -m "feat(i18n): translate MemberSearchPicker component"
```

---

### Task 22: Translate tab layout labels

**Files:**

- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Add `useTranslation` import and hook**

```typescript
import { useTranslation } from 'react-i18next';
```

Inside `TabLayout`, add `const { t } = useTranslation();`

- [ ] **Step 2: Replace hardcoded tab titles**

| Line | Before              | After                       |
| ---- | ------------------- | --------------------------- |
| 33   | `title: 'Groups'`   | `title: t('tabs.groups')`   |
| 42   | `title: 'Friends'`  | `title: t('tabs.friends')`  |
| 51   | `title: 'Activity'` | `title: t('tabs.activity')` |
| 60   | `title: 'Account'`  | `title: t('tabs.account')`  |

- [ ] **Step 3: Commit**

```bash
git add app/(tabs)/_layout.tsx
git commit -m "feat(i18n): translate tab bar labels"
```

---

### Task 23: Translate SplashScreen component

**Files:**

- Modify: `components/SplashScreen.tsx`

- [ ] **Step 1: Add `useTranslation` import and hook**

```typescript
import { useTranslation } from 'react-i18next';
```

Inside `SplashScreen`, add `const { t } = useTranslation();`

Note: SplashScreen renders before i18n is fully initialized (it's shown during the `!i18nReady` gate in `_layout.tsx`). However, `react-i18next` falls back to the key if i18n isn't ready yet. To handle this gracefully, keep the English default in the `loadingText` prop default value as a fallback:

```typescript
export default function SplashScreen({ loadingText }: SplashScreenProps) {
  const { t } = useTranslation();
  const displayText = loadingText ?? t('splash.loading');
  // ...use displayText instead of loadingText
```

- [ ] **Step 2: Replace strings**

| Before                            | After                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| `'Loading…'` (default prop)       | Remove default, use `t('splash.loading')` inside component |
| `'Settling expenses made simple'` | `{t('splash.tagline')}`                                    |

- [ ] **Step 3: Commit**

```bash
git add components/SplashScreen.tsx
git commit -m "feat(i18n): translate SplashScreen component"
```

---

## Chunk 5: Verification & Cleanup

### Task 24: Full verification pass

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Fix any lint errors introduced by the changes.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Fix any TypeScript errors.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

If tests fail due to snapshot or string assertion changes, update them. The `react-i18next` mock returns translation keys, so assertions checking for English text may need updating to check for the key instead.

- [ ] **Step 4: Manual smoke test**

Start the dev server and verify:

- App loads without crash (i18n initializes properly)
- All screens show English text (not raw keys)
- Language picker appears in Account settings
- Selecting Hindi + restart shows Hindi text

```bash
pnpm dev
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(i18n): address lint, typecheck, and test issues"
```

---

### Task 25: Final commit and summary

- [ ] **Step 1: Verify all pre-PR gates pass**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

All must pass.

- [ ] **Step 2: Review diff summary**

```bash
git log --oneline main..HEAD
```

Expected: ~12 commits covering infrastructure, each screen, and verification.
