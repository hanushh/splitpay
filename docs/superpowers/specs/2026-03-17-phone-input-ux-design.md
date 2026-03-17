# Phone Input UX — Design Spec
**Date:** 2026-03-17
**Status:** Approved

---

## Problem

All phone inputs in the app are plain `TextInput` fields. Users must manually type the full E.164 number (e.g. `+91 98765 43210`), which is error-prone and unfriendly. The app is primarily used in India but has some international users.

---

## Solution

Replace every phone `TextInput` with a new shared `PhoneInput` component. It renders an inline country-code pill and a digit-only field side by side, auto-formats as the user types, and normalises to E.164 on save.

---

## Component: `components/ui/PhoneInput.tsx`

### Props
```ts
interface PhoneInputProps {
  value: string;              // E.164 or empty string
  onChange: (e164: string) => void;  // called on every valid keystroke
  autoFocus?: boolean;
  testID?: string;
}
```

`value` and `onChange` always exchange **raw E.164** (e.g. `+919876543210`). Formatting is internal.

### Layout
```
┌─────────────────────────────────────────────┐
│  🇮🇳 +91  ▾  │  98765 43210                │
└─────────────────────────────────────────────┘
```

- **Left pill** (`Pressable`): flag emoji + dial code + `▾` chevron. Tapping opens the country bottom sheet.
- **Vertical divider** (1 px, `surfaceHL` colour).
- **Right field** (`TextInput`): `keyboardType="phone-pad"`, shows only the local digits, formatted.

### Auto-formatting rules
| Dial code | Format pattern | Max local digits |
|---|---|---|
| `+91` (India) | `XXXXX XXXXX` | 10 |
| `+1` (US/CA) | `XXX XXX XXXX` | 10 |
| `+44` (UK) | `XXXX XXXXXX` | 10 |
| `+971` (UAE) | `XX XXX XXXX` | 9 |
| All others | space every 4 digits | 12 |

On every digit change: strip non-digits, apply the pattern, call `onChange(dialCode + strippedDigits)`.

### Country picker bottom sheet
- Renders over a semi-transparent overlay (`rgba(0,0,0,0.5)`).
- **Pinned row** at top: India 🇮🇳.
- ~20 commonly-used countries listed alphabetically below India:
  Australia 🇦🇺, Canada 🇨🇦, France 🇫🇷, Germany 🇩🇪, Indonesia 🇮🇩, Japan 🇯🇵, Malaysia 🇲🇾, Mexico 🇲🇽, Nepal 🇳🇵, New Zealand 🇳🇿, Nigeria 🇳🇬, Pakistan 🇵🇰, Philippines 🇵🇭, Singapore 🇸🇬, South Africa 🇿🇦, Sri Lanka 🇱🇰, UAE 🇦🇪, UK 🇬🇧, US 🇺🇸.
- Each row: `flag  Country name  +dialCode`.
- Tap a row → update pill, clear digit field, close sheet.
- Styled with app theme (`surface` background, white text, `primary` highlight on press).
- No external dependency — built with RN `Modal` + `FlatList`.

---

## Integration Points

All three existing phone inputs adopt `PhoneInput`:

| Screen / File | Current input | Change |
|---|---|---|
| `app/auth/setup-phone.tsx` | plain `TextInput` | replace with `<PhoneInput>` |
| `app/(tabs)/account.tsx` | plain `TextInput` in modal | replace with `<PhoneInput>` |
| `app/auth/sign-up.tsx` | plain `TextInput` | replace with `<PhoneInput>` |

---

## Data Flow

1. `PhoneInput` calls `onChange` with the raw concatenated string (e.g. `+919876543210`) on every keystroke.
2. Parent screens pass this value directly to `normalizePhone()` at submission time.
3. `normalizePhone()` (already in `lib/phone.ts`) validates and returns a clean E.164 string or `null`.
4. No change to DB storage or RPC calls.

---

## Styling

Follows the existing colour palette:
- Container border: `surfaceHL` (#244732), 1.5 px, radius 12
- Background: `surface` (#1a3324)
- Pill text / digit text: white (#ffffff)
- Placeholder: `slate500` (#64748b)
- Chevron icon: `slate400` (#94a3b8)
- Height: 52 px (matches existing inputs)

---

## Testing

- `PhoneInput` unit test: given dial code + digit input, assert `onChange` called with correct E.164.
- Formatting snapshots: +91 → `98765 43210`, +1 → `415 555 1234`, other → `1234 5678`.
- Existing auth context tests unaffected (they pass pre-normalised phone strings).

---

## Out of Scope

- Full 200-country list (use the 20-country curated list; can expand later).
- SMS OTP verification.
- Phone number portability detection.
